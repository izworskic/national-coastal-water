"use strict";

/*
 * Oregon Coastal Window Engine
 *
 * This module intentionally keeps site-specific source truth separate. It does
 * not create a universal tide formula and it never labels an activity "safe".
 * Published access/discovery guidance wins when it exists; conflicts and
 * malformed source material fail closed.
 */

const STATUS = Object.freeze({
  OFFICIAL_WINDOW: "OFFICIAL_WINDOW",
  TIDEPOOL_OPPORTUNITY: "TIDEPOOL_OPPORTUNITY",
  NO_OPPORTUNITY: "NO_OPPORTUNITY",
  SOURCE_CONFLICT: "SOURCE_CONFLICT",
  SOURCE_UNAVAILABLE: "SOURCE_UNAVAILABLE",
  CONSERVATIVE_ACCESS_OPPORTUNITY: "CONSERVATIVE_ACCESS_OPPORTUNITY",
  RESEARCH_ONLY: "RESEARCH_ONLY",
  HAZARD_VETO: "HAZARD_VETO",
});

const SITE = Object.freeze({
  YAQUINA: "YAQUINA",
  HAYSTACK: "HAYSTACK",
  HUG_POINT: "HUG_POINT",
  THORS_WELL: "THORS_WELL",
});

const HAYSTACK_MAX_TIDEPOOL_LOW_FT = 1.0;

function normalizedSourceGate(source) {
  if (!source || source.status !== "ok") {
    return {
      ok: false,
      status: STATUS.SOURCE_UNAVAILABLE,
      reason_code: source?.status === "stale" ? "STALE_SOURCE" : "SOURCE_UNAVAILABLE",
    };
  }
  if (source.conflict === true) {
    return { ok: false, status: STATUS.SOURCE_CONFLICT, reason_code: "SOURCE_CONFLICT" };
  }
  return { ok: true };
}

function normalizeClockText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, "");
}

function clockParts(value, inheritedMeridiem = null) {
  const text = normalizeClockText(value);
  const match = text.match(/^(\d{1,2})(?::(\d{2}))?([ap])(?:m)?$/i)
    || text.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!match) throw new Error(`Unparseable published clock token: ${value}`);

  const hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const explicit = match[3] ? match[3].toLowerCase() : null;
  const meridiem = explicit || inheritedMeridiem;

  if (hour < 1 || hour > 12 || minute < 0 || minute > 59 || !meridiem) {
    throw new Error(`Ambiguous published clock token: ${value}`);
  }

  let hour24 = hour % 12;
  if (meridiem === "p") hour24 += 12;

  return {
    minute_of_day: hour24 * 60 + minute,
    meridiem,
    explicit_meridiem: Boolean(explicit),
    raw: String(value).trim(),
  };
}

function parsePublishedWindow(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error("Published window is missing");
  }

  const parts = raw.trim().split(/\s*[\u2012\u2013\u2014-]\s*/);
  if (parts.length !== 2) throw new Error(`Unparseable published window: ${raw}`);

  const suffix = (normalizeClockText(parts[1]).match(/([ap])(?:m)?$/i) || [])[1]?.toLowerCase() || null;
  const start = clockParts(parts[0], suffix);
  const end = clockParts(parts[1], start.meridiem);

  // Never repair a suspicious AM/PM value by silently flipping meridiem.
  if (end.minute_of_day < start.minute_of_day) {
    throw new Error(`Published window has reversed clock order: ${raw}`);
  }

  return {
    raw,
    start_minute: start.minute_of_day,
    end_minute: end.minute_of_day,
    start_meridiem: start.meridiem,
    end_meridiem: end.meridiem,
    auto_corrected: false,
  };
}

function parsePublishedClock(raw) {
  const parsed = clockParts(raw);
  return {
    raw,
    minute_of_day: parsed.minute_of_day,
    meridiem: parsed.meridiem,
    auto_corrected: false,
  };
}

function baseResult(site, date, status, extra = {}) {
  return {
    site,
    date: date || null,
    status,
    safe: null,
    ...extra,
  };
}

function evaluateYaquina(input = {}) {
  const gate = normalizedSourceGate(input.source);
  if (!gate.ok) return baseResult(SITE.YAQUINA, input.date, gate.status, { reason_code: gate.reason_code, window: null });

  const published = String(input.discovery ?? "").trim();
  if (!published) {
    return baseResult(SITE.YAQUINA, input.date, STATUS.SOURCE_UNAVAILABLE, {
      reason_code: "MISSING_DISCOVERY_ENTRY",
      window: null,
    });
  }

  if (/^no\s+exposure$/i.test(published)) {
    return baseResult(SITE.YAQUINA, input.date, STATUS.NO_OPPORTUNITY, {
      reason_code: "NO_EXPOSURE",
      source_text: published,
      window: null,
    });
  }

  let window;
  try {
    window = parsePublishedWindow(published);
  } catch (error) {
    return baseResult(SITE.YAQUINA, input.date, STATUS.SOURCE_CONFLICT, {
      reason_code: "UNPARSABLE_OR_AMBIGUOUS_OFFICIAL_WINDOW",
      source_text: published,
      detail: error.message,
      window: null,
      auto_corrected: false,
    });
  }

  if (input.closing) {
    let closing;
    try {
      closing = parsePublishedClock(input.closing);
    } catch (error) {
      return baseResult(SITE.YAQUINA, input.date, STATUS.SOURCE_CONFLICT, {
        reason_code: "UNPARSABLE_CLOSING_TIME",
        source_text: published,
        closing_text: input.closing,
        detail: error.message,
        window: null,
        auto_corrected: false,
      });
    }

    if (window.end_minute > closing.minute_of_day) {
      return baseResult(SITE.YAQUINA, input.date, STATUS.SOURCE_CONFLICT, {
        reason_code: "OFFICIAL_WINDOW_AFTER_CLOSING",
        source_text: published,
        closing_text: input.closing,
        source_window: window,
        closing,
        window: null,
        auto_corrected: false,
      });
    }
  }

  return baseResult(SITE.YAQUINA, input.date, STATUS.OFFICIAL_WINDOW, {
    reason_code: "PUBLISHED_TIDEPOOL_DISCOVERY_WINDOW",
    source_text: published,
    window,
    auto_corrected: false,
  });
}

function evaluateHaystack(input = {}) {
  const gate = normalizedSourceGate(input.source);
  if (!gate.ok) return baseResult(SITE.HAYSTACK, input.date, gate.status, { reason_code: gate.reason_code, window: null });

  const threshold = Number.isFinite(input.threshold_ft)
    ? input.threshold_ft
    : HAYSTACK_MAX_TIDEPOOL_LOW_FT;
  const daylightLowFt = Number(input.daylight_low_ft);

  if (!Number.isFinite(daylightLowFt)) {
    return baseResult(SITE.HAYSTACK, input.date, STATUS.SOURCE_UNAVAILABLE, {
      reason_code: "MISSING_DAYLIGHT_LOW",
      threshold_ft: threshold,
      window: null,
    });
  }

  if (daylightLowFt > threshold) {
    return baseResult(SITE.HAYSTACK, input.date, STATUS.NO_OPPORTUNITY, {
      reason_code: "DAYLIGHT_LOW_ABOVE_HRAP_THRESHOLD",
      daylight_low_ft: daylightLowFt,
      threshold_ft: threshold,
      window: null,
    });
  }

  return baseResult(SITE.HAYSTACK, input.date, STATUS.TIDEPOOL_OPPORTUNITY, {
    reason_code: "DAYLIGHT_LOW_MEETS_HRAP_THRESHOLD",
    daylight_low_ft: daylightLowFt,
    threshold_ft: threshold,
    low_tide_time: input.low_tide_time || null,
    window: null,
  });
}

function evaluateHugPoint(input = {}) {
  const gate = normalizedSourceGate(input.source);
  if (!gate.ok) return baseResult(SITE.HUG_POINT, input.date, gate.status, { reason_code: gate.reason_code, window: null });

  if (input.hazard_veto === true) {
    return baseResult(SITE.HUG_POINT, input.date, STATUS.HAZARD_VETO, {
      reason_code: input.hazard_reason || "HAZARD_VETO",
      window: null,
      safe_until: null,
    });
  }

  if (input.low_tide_opportunity !== true) {
    return baseResult(SITE.HUG_POINT, input.date, STATUS.NO_OPPORTUNITY, {
      reason_code: "NO_LOW_TIDE_ACCESS_OPPORTUNITY",
      window: null,
      safe_until: null,
    });
  }

  // Oregon State Parks warns that tide and sand conditions vary and people can
  // become stranded. A low-tide opportunity is therefore intentionally not
  // converted into an exact safe-until timestamp.
  return baseResult(SITE.HUG_POINT, input.date, STATUS.CONSERVATIVE_ACCESS_OPPORTUNITY, {
    reason_code: "LOW_TIDE_ACCESS_WITH_VARIABLE_SITE_CONDITIONS",
    low_tide_time: input.low_tide_time || null,
    safe_until: null,
    exact_cutoff: false,
    window: null,
  });
}

function evaluateThorsWell(input = {}) {
  return baseResult(SITE.THORS_WELL, input.date, STATUS.RESEARCH_ONLY, {
    reason_code: "INSUFFICIENT_CALIBRATION_EVIDENCE",
    production_window: null,
    window: null,
    classifier_enabled: false,
  });
}

function evaluate(site, input = {}) {
  switch (site) {
    case SITE.YAQUINA: return evaluateYaquina(input);
    case SITE.HAYSTACK: return evaluateHaystack(input);
    case SITE.HUG_POINT: return evaluateHugPoint(input);
    case SITE.THORS_WELL: return evaluateThorsWell(input);
    default: return baseResult(site || null, input.date, STATUS.SOURCE_UNAVAILABLE, { reason_code: "UNKNOWN_SITE", window: null });
  }
}

module.exports = {
  STATUS,
  SITE,
  HAYSTACK_MAX_TIDEPOOL_LOW_FT,
  evaluate,
  _test: {
    normalizedSourceGate,
    parsePublishedClock,
    parsePublishedWindow,
    evaluateYaquina,
    evaluateHaystack,
    evaluateHugPoint,
    evaluateThorsWell,
  },
};

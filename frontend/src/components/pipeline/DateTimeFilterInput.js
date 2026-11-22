import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isValidFilterDateTime, parseFilterDateTime } from '../../lib/pipeline/workflow';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const HOURS = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'));
const SECONDS = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'));

const pad2 = (value) => String(value).padStart(2, '0');

function formatIsoDate(year, monthIndex, day) {
  return `${String(year).padStart(4, '0')}-${pad2(monthIndex + 1)}-${pad2(day)}`;
}

function formatOutput(dateStr, includeTime, time) {
  if (!dateStr) return '';
  if (!includeTime) return dateStr;
  return `${dateStr} ${time.hour}:${time.minute}:${time.second}`;
}

export default function DateTimeFilterInput({ label, value = '', onChange, disabled = false }) {
  const inputId = useId();
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const popoverRef = useRef(null);
  const suppressNextFocusOpenRef = useRef(false);

  const parsed = parseFilterDateTime(value);
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(() => parsed?.year ?? new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => (parsed ? parsed.month - 1 : new Date().getMonth()));
  const [includeTime, setIncludeTime] = useState(() => Boolean(parsed?.hasTime));
  const [time, setTime] = useState(() => (parsed?.hasTime
    ? { hour: pad2(parsed.hour), minute: pad2(parsed.minute), second: pad2(parsed.second) }
    : { hour: '00', minute: '00', second: '00' }));
  const [rejectedNotice, setRejectedNotice] = useState('');
  const [coords, setCoords] = useState({ top: 8, left: 8 });

  useEffect(() => {
    setRejectedNotice('');
    const nextParsed = parseFilterDateTime(value);
    if (nextParsed) {
      setViewYear(nextParsed.year);
      setViewMonth(nextParsed.month - 1);
      setIncludeTime(nextParsed.hasTime);
      if (nextParsed.hasTime) {
        setTime({
          hour: pad2(nextParsed.hour),
          minute: pad2(nextParsed.minute),
          second: pad2(nextParsed.second),
        });
      }
    } else if (!value) {
      setIncludeTime(false);
      setTime({ hour: '00', minute: '00', second: '00' });
    }
  }, [value]);

  useEffect(() => {
    if (disabled && open) setOpen(false);
  }, [disabled, open]);

  const updatePosition = useCallback(() => {
    const anchor = inputRef.current || wrapRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const popRect = popoverRef.current?.getBoundingClientRect();
    const width = (popRect && popRect.width > 0) ? popRect.width : 280;
    const height = (popRect && popRect.height > 0) ? popRect.height : 340;
    const vw = window.innerWidth || 1024;
    const vh = window.innerHeight || 768;
    const MARGIN = 8;
    const GAP = 4;
    const left = Math.min(Math.max(MARGIN, rect.left), Math.max(MARGIN, vw - width - MARGIN));
    const belowTop = rect.bottom + GAP;
    const aboveTop = rect.top - GAP - height;
    const rawTop = (belowTop + height > vh - MARGIN && aboveTop >= MARGIN) ? aboveTop : belowTop;
    const top = Math.min(Math.max(MARGIN, rawTop), Math.max(MARGIN, vh - height - MARGIN));
    setCoords({ top: Math.round(top), left: Math.round(left) });
  }, []);

  useLayoutEffect(() => {
    if (!open) return undefined;
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, includeTime, viewYear, viewMonth, updatePosition]);

  const focusInputWithoutReopen = useCallback(() => {
    if (inputRef.current && document.activeElement !== inputRef.current) {
      suppressNextFocusOpenRef.current = true;
      inputRef.current.focus();
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const handleOutside = (event) => {
      const target = event.target;
      if (!target || !target.isConnected) return;
      if (wrapRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        setOpen(false);
        focusInputWithoutReopen();
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('click', handleOutside);
    document.addEventListener('focusin', handleOutside);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('click', handleOutside);
      document.removeEventListener('focusin', handleOutside);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open, focusInputWithoutReopen]);

  const isAtMinMonth = viewYear <= 1 && viewMonth === 0;

  function goPrevMonth() {
    if (viewYear <= 1 && viewMonth === 0) return;
    if (viewMonth === 0) {
      setViewYear((year) => year - 1);
      setViewMonth(11);
    } else {
      setViewMonth((month) => month - 1);
    }
  }

  function goNextMonth() {
    if (viewMonth === 11) {
      setViewYear((year) => year + 1);
      setViewMonth(0);
    } else {
      setViewMonth((month) => month + 1);
    }
  }

  function selectDay(iso) {
    setRejectedNotice('');
    onChange(formatOutput(iso, includeTime, time));
    if (!includeTime) setOpen(false);
  }

  function toggleIncludeTime(event) {
    const next = event.target.checked;
    setIncludeTime(next);
    setRejectedNotice('');
    if (parsed?.dateStr) {
      onChange(formatOutput(parsed.dateStr, next, time));
    }
  }

  function updateTimePart(part, nextVal) {
    const nextTime = { ...time, [part]: nextVal };
    setTime(nextTime);
    setRejectedNotice('');
    if (parsed?.dateStr) {
      onChange(formatOutput(parsed.dateStr, true, nextTime));
    }
  }

  function selectToday() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const day = now.getDate();
    const todayIso = formatIsoDate(year, month, day);
    setViewYear(year);
    setViewMonth(month);
    setRejectedNotice('');
    onChange(formatOutput(todayIso, includeTime, time));
    if (!includeTime) setOpen(false);
  }

  function clearValue() {
    setRejectedNotice('');
    onChange('');
    setOpen(false);
  }

  const firstDayRef = new Date(0);
  firstDayRef.setFullYear(viewYear, viewMonth, 1);
  const firstWeekday = firstDayRef.getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  return (
    <div className="etl-field dt-picker-field" ref={wrapRef}>
      <label htmlFor={inputId}>{label}</label>
      <div className="dt-picker-input-row">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          value={value ?? ''}
          placeholder="YYYY-MM-DD"
          disabled={disabled}
          aria-haspopup="dialog"
          onFocus={() => {
            if (disabled) return;
            if (suppressNextFocusOpenRef.current) {
              suppressNextFocusOpenRef.current = false;
              return;
            }
            setOpen(true);
          }}
          onBlur={() => {
            suppressNextFocusOpenRef.current = false;
          }}
          onClick={() => {
            if (!disabled) setOpen(true);
          }}
          onChange={(event) => {
            const raw = event.target.value;
            if (raw === '') {
              setRejectedNotice('');
              onChange('');
              return;
            }
            if (isValidFilterDateTime(raw)) {
              setRejectedNotice('');
              onChange(raw.trim());
              return;
            }
            setRejectedNotice('Use the calendar or enter YYYY-MM-DD or YYYY-MM-DD HH:mm:ss.');
          }}
        />
        <button
          type="button"
          className="button button-secondary dt-picker-trigger"
          disabled={disabled}
          aria-label="Open calendar"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => {
            setRejectedNotice('');
            setOpen((prev) => !prev);
          }}
        >
          Calendar
        </button>
      </div>
      {rejectedNotice && <p className="etl-muted dt-picker-hint" role="status">{rejectedNotice}</p>}
      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Choose date and time"
          className="dt-picker-popover"
          style={{ position: 'fixed', top: `${coords.top}px`, left: `${coords.left}px`, zIndex: 1000 }}
        >
          <div className="dt-picker-header">
            <button type="button" className="button button-secondary" aria-label="Previous month" disabled={disabled || isAtMinMonth} onClick={goPrevMonth}>‹</button>
            <span className="dt-picker-month-label" aria-live="polite">{MONTH_NAMES[viewMonth]} {viewYear}</span>
            <button type="button" className="button button-secondary" aria-label="Next month" onClick={goNextMonth}>›</button>
          </div>
          <div className="dt-picker-weekdays" aria-hidden="true">
            {WEEKDAYS.map((dayName) => <span key={dayName}>{dayName}</span>)}
          </div>
          <div className="dt-picker-grid">
            {Array.from({ length: firstWeekday }, (_, idx) => (
              <span key={`empty-${idx}`} className="dt-picker-spacer" aria-hidden="true" />
            ))}
            {Array.from({ length: daysInMonth }, (_, idx) => {
              const day = idx + 1;
              const iso = formatIsoDate(viewYear, viewMonth, day);
              const isSelected = parsed?.dateStr === iso;
              return (
                <button
                  key={iso}
                  type="button"
                  className={`dt-picker-day${isSelected ? ' is-selected' : ''}`}
                  aria-pressed={isSelected}
                  data-date={iso}
                  onClick={() => selectDay(iso)}
                >
                  {day}
                </button>
              );
            })}
          </div>
          <div className="dt-picker-time">
            <label className="dt-picker-time-toggle">
              <input type="checkbox" checked={includeTime} onChange={toggleIncludeTime} />
              Include time
            </label>
            {includeTime && (
              <div className="dt-picker-time-selects">
                <select aria-label="Hour" value={time.hour} onChange={(event) => updateTimePart('hour', event.target.value)}>
                  {HOURS.map((hour) => <option key={hour} value={hour}>{hour}</option>)}
                </select>
                <span aria-hidden="true">:</span>
                <select aria-label="Minute" value={time.minute} onChange={(event) => updateTimePart('minute', event.target.value)}>
                  {MINUTES.map((minute) => <option key={minute} value={minute}>{minute}</option>)}
                </select>
                <span aria-hidden="true">:</span>
                <select aria-label="Second" value={time.second} onChange={(event) => updateTimePart('second', event.target.value)}>
                  {SECONDS.map((second) => <option key={second} value={second}>{second}</option>)}
                </select>
              </div>
            )}
          </div>
          <div className="dt-picker-actions">
            <button type="button" className="button button-secondary" onClick={selectToday}>Today</button>
            <button type="button" className="button button-secondary" onClick={clearValue}>Clear</button>
            <button
              type="button"
              className="button button-primary"
              onClick={() => {
                setOpen(false);
                focusInputWithoutReopen();
              }}
            >
              Done
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

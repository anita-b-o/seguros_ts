import { useEffect, useRef, useState } from "react";

export default function AsyncAutocomplete({
  label,
  placeholder,
  value,
  onChange,
  loadOptions, // (query) => Promise<{label,value}[]>
  disabled,
  required,
  hint,
}) {
  const [q, setQ] = useState(value || "");
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef(null);

  useEffect(() => setQ(value || ""), [value]);

  useEffect(() => {
    let alive = true;

    const run = async () => {
      setLoading(true);
      try {
        const data = await loadOptions(q);
        if (!alive) return;
        setOpts(Array.isArray(data) ? data : []);
      } catch {
        if (!alive) return;
        setOpts([]);
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    };

    const t = setTimeout(run, 220);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, loadOptions]);

  useEffect(() => {
    const onDoc = (e) => {
      if (!boxRef.current) return;
      if (!boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const showList = open && !disabled && (opts.length > 0 || loading);

  const pick = (item) => {
    onChange(item?.label ?? q);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e) => {
    if (!showList) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((p) => Math.min(p + 1, opts.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((p) => Math.max(p - 1, 0));
    } else if (e.key === "Enter") {
      if (active >= 0 && opts[active]) {
        e.preventDefault();
        pick(opts[active]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="aa" ref={boxRef}>
      <label className="form-label">
        {label} {required ? <span className="req">*</span> : null}
        <input
          className="form-input"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            onChange(e.target.value); // escritura libre
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
        />
      </label>

      {hint ? <p className="form-hint">{hint}</p> : null}

      {showList ? (
        <div className="aa-pop" role="listbox">
          {loading ? <div className="aa-item muted">Buscando…</div> : null}
          {!loading && opts.length === 0 ? (
            <div className="aa-item muted">Sin coincidencias. Podés dejar lo escrito.</div>
          ) : null}
          {opts.map((it, idx) => (
            <button
              type="button"
              key={`${it.value}-${idx}`}
              className={`aa-item ${idx === active ? "active" : ""}`}
              onMouseEnter={() => setActive(idx)}
              onClick={() => pick(it)}
            >
              {it.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// src/pages/dashboard/AssociatePolicyPage.jsx
import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";

import {
  associatePolicyByNumber,
  clearAssociateError,
  clearAssociateState,
} from "@/features/policiesAssociate/policiesAssociateSlice";

import "@/styles/associatePolicy.css";

function normalizePolicyNumber(raw) {
  return String(raw || "").trim();
}

function validatePolicyNumber(value) {
  if (!value) return "Ingresá el número de póliza.";
  if (value.length < 3) return "El número de póliza parece demasiado corto.";
  return null;
}

export default function AssociatePolicyPage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const { loading, error, lastAssociated } = useSelector((s) => s.policiesAssociate);

  const [policyNumber, setPolicyNumber] = useState("");
  const [touched, setTouched] = useState(false);

  const normalized = useMemo(() => normalizePolicyNumber(policyNumber), [policyNumber]);

  const validationError = useMemo(
    () => (touched ? validatePolicyNumber(normalized) : null),
    [normalized, touched]
  );

  useEffect(() => {
    dispatch(clearAssociateState());
    return () => dispatch(clearAssociateState());
  }, [dispatch]);

  const message = useMemo(() => {
    if (!error) return null;

    const status = error?.status;
    if (status === 404) return "No encontramos una póliza con ese número.";
    if (status === 409) return "Esa póliza ya está asociada a otra cuenta.";
    if (status === 400) return error?.detail || "El número ingresado no es válido.";
    if (status === 401) return "Tu sesión expiró. Volvé a iniciar sesión.";
    return error?.detail || "No se pudo asociar la póliza.";
  }, [error]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setTouched(true);
    dispatch(clearAssociateError());

    const errMsg = validatePolicyNumber(normalized);
    if (errMsg) return;

    const res = await dispatch(associatePolicyByNumber({ policy_number: normalized }));

    // Si querés navegar automático:
    // if (associatePolicyByNumber.fulfilled.match(res)) navigate("/dashboard");
  };

  return (
    <div className="dash-page ap-page">
      <div className="dash-head ap-head">
        <div>
          <h1 className="dash-title ap-title">Asociar póliza</h1>
          <p className="dash-sub ap-sub">
            Ingresá el número de póliza para vincularla a tu cuenta.
          </p>
        </div>
      </div>

      <div className="dash-card ap-card">
        <div className="dash-card-head ap-cardHead">
          <div>
            <div className="dash-kicker">CUENTA</div>
            <h2 className="dash-h2">Vincular póliza</h2>
          </div>

          <button
            type="button"
            className="ap-btn ap-btn-ghost"
            onClick={() => navigate("/dashboard/profile")}
            disabled={loading}
            title="Ir a Mi perfil"
          >
            Mi perfil
          </button>
        </div>

        {message ? <div className="dash-alert ap-alert ap-alert-error">{message}</div> : null}

        {lastAssociated ? (
          <div className="ap-alert ap-alert-ok">
            <strong>{lastAssociated?.message || "Póliza asociada correctamente."}</strong>{" "}
            {lastAssociated?.message
              ? null
              : "Ya podés verla en tu panel."}
          </div>
        ) : null}

        <form className="ap-form" onSubmit={onSubmit}>
          <div className="ap-field">
            <label className="dash-label ap-label" htmlFor="policyNumber">
              Número de póliza
            </label>

            <input
              id="policyNumber"
              className={`dash-select ap-input ${validationError ? "is-error" : ""}`}
              value={policyNumber}
              onChange={(e) => setPolicyNumber(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="Ej: SC-000123"
              autoComplete="off"
              inputMode="text"
              disabled={loading}
            />

            {validationError ? (
              <div className="dash-hint ap-help ap-error">{validationError}</div>
            ) : (
              <div className="dash-hint ap-help">
                Solo podés asociar pólizas sin cliente asignado.
              </div>
            )}
          </div>

          <div className="dash-actions ap-actions">
            <button
              type="button"
              className="ap-btn ap-btn-secondary"
              onClick={() => navigate("/dashboard")}
              disabled={loading}
            >
              Volver
            </button>

            <button type="submit" className="ap-btn ap-btn-primary" disabled={loading}>
              {loading ? "Asociando..." : "Asociar"}
            </button>
          </div>

          {lastAssociated ? (
            <div className="ap-next">
              <button type="button" className="ap-link" onClick={() => navigate("/dashboard")}>
                Ir a Mi panel
              </button>
            </div>
          ) : null}
        </form>
      </div>
    </div>
  );
}

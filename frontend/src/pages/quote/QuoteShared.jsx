import React from "react";
import { useParams } from "react-router-dom";

export default function QuoteShared() {
  const { token } = useParams();

  return (
    <div style={{ padding: 24 }}>
      <h2>Cotización compartida</h2>
      <p>Token: {token}</p>
      <p>En construcción.</p>
    </div>
  );
}

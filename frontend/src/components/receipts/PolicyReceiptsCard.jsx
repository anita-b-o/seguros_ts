// src/components/receipts/PolicyReceiptsCard.jsx
import { useEffect } from "react";
import { useDispatch } from "react-redux";
import { openReceiptModal, receiptsKey } from "@/features/receipts/receiptsSlice";

import PolicyCardHeader from "./PolicyCardHeader";
import ReceiptsList from "./ReceiptsList";

export default function PolicyReceiptsCard({
  policy,
  isOpen,
  page,
  receiptsByPolicyPage,
  onToggle,
  onChangePage,
  onEnsureLoaded,
}) {
  const dispatch = useDispatch();
  const policyId = policy.id;

  // Cuando abre, cargá lo que corresponda
  useEffect(() => {
    if (isOpen) onEnsureLoaded?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const receiptsState = receiptsByPolicyPage?.[receiptsKey(policyId, page)];
  return (
    <div className={`rcpt-policyCard ${isOpen ? "is-open" : ""}`}>
      <button className="rcpt-policyHead" onClick={onToggle} type="button">
        <PolicyCardHeader policy={policy} />
        <div className="rcpt-chevron">{isOpen ? "▾" : "▸"}</div>
      </button>

      {isOpen ? (
        <div className="rcpt-policyBody">
          <ReceiptsList
            policy={policy}
            state={receiptsState}
            page={page}
            onClickReceipt={(r) => dispatch(openReceiptModal({ policy, receipt: r }))}
            onPrev={() => onChangePage(Math.max(1, page - 1))}
            onNext={() => onChangePage(page + 1)}
          />
        </div>
      ) : null}
    </div>
  );
}

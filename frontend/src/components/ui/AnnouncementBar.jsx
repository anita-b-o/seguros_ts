import { useEffect, useState } from "react";
import { apiPublic } from "@/api";
import "./announcementbar.css";

export default function AnnouncementBar() {
  const enabled = import.meta.env.VITE_ENABLE_ANNOUNCEMENTS === "true";
  const [items, setItems] = useState([]);
  const [dismissed, setDismissed] = useState({});

  if (!enabled) return null;

  useEffect(()=>{
    (async ()=>{
      try {
      const { data } = await apiPublic.get("/common/announcements/");
        setItems(Array.isArray(data) ? data : []);
      } catch {}
    })();
  },[]);

  if (!items.length) return null;

  return (
    <div className="ann-bar">
      {items.map(a => {
        if (dismissed[a.id]) return null;
        return (
          <div className="ann-item" key={a.id}>
            <span className="ann-title">{a.title}</span>
            {a.message && <span className="ann-msg">{a.message}</span>}
            {a.link && <a href={a.link} target="_blank" rel="noreferrer" className="ann-link">Más info</a>}
            <button className="ann-close" onClick={()=>setDismissed(d => ({...d, [a.id]: true}))} aria-label="Cerrar">×</button>
          </div>
        );
      })}
    </div>
  );
}

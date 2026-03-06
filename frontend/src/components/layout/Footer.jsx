import "./footer.css";

export default function Footer() {
  return (
    <footer className="footer" role="contentinfo">
      <div className="footer__bottom container">
        <p className="footer__copy">
          © {new Date().getFullYear()} Seguros Tony Sierra. Todos los derechos reservados.
        </p>
        <p className="footer__dev">
          Desarrollado por{" "}
          <a href="https://wa.me/2241572171" target="_blank" rel="noopener noreferrer">
            Ormello Anita
          </a>
        </p>
      </div>
    </footer>
  );
}

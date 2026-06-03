import React from "react";
import "./CompanyFooter.css";

const YEAR = new Date().getFullYear();

export default function CompanyFooter({ onNavigate }) {
  return (
    <footer className="co-footer">
      <div className="co-footer-inner">

        <div className="co-footer-brand">
          <div className="co-footer-logo">J</div>
          <div className="co-footer-brand-text">
            <span className="co-footer-product">JARVIS</span>
            <span className="co-footer-brand-sub">by Ooplix</span>
          </div>
        </div>

        <nav className="co-footer-nav" aria-label="Legal navigation">
          <button className="co-footer-link" onClick={() => onNavigate?.("company")}>Company</button>
          <button className="co-footer-link" onClick={() => onNavigate?.("privacy")}>Privacy Policy</button>
          <button className="co-footer-link" onClick={() => onNavigate?.("terms")}>Terms of Service</button>
          <button className="co-footer-link" onClick={() => onNavigate?.("refund")}>Refund Policy</button>
          <button className="co-footer-link" onClick={() => onNavigate?.("contact")}>Contact</button>
          <button className="co-footer-link" onClick={() => onNavigate?.("trust")}>Trust & Compliance</button>
        </nav>

        <p className="co-footer-legal">
          &copy; {YEAR} ALWALIY TECHNOLOGIES PRIVATE LIMITED. All rights reserved.
          JARVIS and Ooplix are trademarks of ALWALIY TECHNOLOGIES PRIVATE LIMITED.
        </p>

      </div>
    </footer>
  );
}

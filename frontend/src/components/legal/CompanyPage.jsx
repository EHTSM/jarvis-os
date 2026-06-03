import React from "react";
import "./Legal.css";

export default function CompanyPage({ onBack }) {
  return (
    <div className="legal-page">
      <div className="legal-inner">
        <button className="legal-back" onClick={onBack}>← Back</button>

        <div className="legal-brand-header">
          <div className="legal-logo-mark">O</div>
          <div>
            <h1 className="legal-product-name">Ooplix</h1>
            <p className="legal-brand-by">AI Operating System</p>
          </div>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">About the Company</h2>
          <div className="legal-company-card">
            <div className="legal-company-row">
              <span className="legal-company-label">Registered Name</span>
              <span className="legal-company-value">ALWALIY TECHNOLOGIES PRIVATE LIMITED</span>
            </div>
            <div className="legal-company-row">
              <span className="legal-company-label">Brand</span>
              <span className="legal-company-value">Ooplix</span>
            </div>
            <div className="legal-company-row">
              <span className="legal-company-label">Flagship Product</span>
              <span className="legal-company-value">Ooplix — AI Operating System</span>
            </div>
            <div className="legal-company-row">
              <span className="legal-company-label">Entity Type</span>
              <span className="legal-company-value">Private Limited Company, India</span>
            </div>
            <div className="legal-company-row">
              <span className="legal-company-label">Contact</span>
              <span className="legal-company-value">
                <a href="mailto:legal@ooplix.com" className="legal-link">legal@ooplix.com</a>
              </span>
            </div>
            <div className="legal-company-row">
              <span className="legal-company-label">Support</span>
              <span className="legal-company-value">
                <a href="mailto:support@ooplix.com" className="legal-link">support@ooplix.com</a>
              </span>
            </div>
          </div>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">Brand Hierarchy</h2>
          <div className="legal-brand-tree">
            <div className="legal-tree-node legal-tree-node--root">
              <span className="legal-tree-label">ALWALIY TECHNOLOGIES PRIVATE LIMITED</span>
              <span className="legal-tree-sub">Legal Entity</span>
            </div>
            <div className="legal-tree-branch">
              <div className="legal-tree-node legal-tree-node--brand">
                <span className="legal-tree-label">Ooplix</span>
                <span className="legal-tree-sub">Product — AI Operating System</span>
              </div>
            </div>
          </div>
        </div>

        <div className="legal-section">
          <h2 className="legal-section-title">What We Build</h2>
          <p className="legal-body">
            ALWALIY TECHNOLOGIES PRIVATE LIMITED builds AI-powered software tools under the Ooplix brand.
            Ooplix is an AI Operating System that helps entrepreneurs, freelancers, and growing
            businesses automate their sales pipeline, manage leads, collect payments, and run
            operations from a single intelligent workspace.
          </p>
        </div>

        <div className="legal-footer-note">
          &copy; {new Date().getFullYear()} ALWALIY TECHNOLOGIES PRIVATE LIMITED. All rights reserved.
          Ooplix is a trademark of ALWALIY TECHNOLOGIES PRIVATE LIMITED.
        </div>
      </div>
    </div>
  );
}

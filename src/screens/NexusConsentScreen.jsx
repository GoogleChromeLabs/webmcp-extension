import React from 'react';
import Header from '../components/Header.jsx';
import { AtomLogo, SymbolIcon } from '../components/Icons.jsx';

/**
 * NexusConsentScreen Component
 * WebMCP Figma Node ID: 3413:128021 ("Consent")
 */
export function NexusConsentScreen({ onGotIt, onClose }) {
  return (
    <div className="nexus-screen nexus-screen--consent" data-node-id="3413:128021">
      <Header variant="consent" />

      <main className="nexus-consent__content">
        {/* Brand Greeting */}
        <div className="nexus-consent__hero">
          <div className="nexus-consent__logo-bg">
            <AtomLogo size={36} color="#012c6f" />
          </div>
          <h1 className="nexus-consent__title">Hi there!</h1>
          <p className="nexus-consent__subtitle">
            Get help with your tabs and tasks with ‘Nexus’
          </p>
        </div>

        {/* Feature List Container */}
        <div className="nexus-consent__feature-card">
          {/* Feature 1 */}
          <div className="nexus-consent__feature-item">
            <div className="nexus-consent__feature-icon">
              <SymbolIcon name="automation" size={20} color="#012c6f" />
            </div>
            <div className="nexus-consent__feature-text">
              <h4 className="nexus-consent__feature-title">Reach your goals, faster</h4>
              <p className="nexus-consent__feature-desc">
                Get things done faster by using WebMCP provided by the site
              </p>
            </div>
          </div>

          {/* Feature 2 */}
          <div className="nexus-consent__feature-item">
            <div className="nexus-consent__feature-icon">
              <SymbolIcon name="sites" size={20} color="#012c6f" />
            </div>
            <div className="nexus-consent__feature-text">
              <h4 className="nexus-consent__feature-title">Use it on trusted sites</h4>
              <p className="nexus-consent__feature-desc">
                You may share personal info with the sites
              </p>
            </div>
          </div>

          {/* Feature 3 */}
          <div className="nexus-consent__feature-item">
            <div className="nexus-consent__feature-icon">
              <SymbolIcon name="shield" size={20} color="#012c6f" />
            </div>
            <div className="nexus-consent__feature-text">
              <h4 className="nexus-consent__feature-title">Stay in control</h4>
              <p className="nexus-consent__feature-desc">
                Shows the steps when appropriate and asks confirmations before the sensitive ones
              </p>
            </div>
          </div>

          {/* Feature 4 */}
          <div className="nexus-consent__feature-item">
            <div className="nexus-consent__feature-icon">
              <SymbolIcon name="description" size={20} color="#012c6f" />
            </div>
            <div className="nexus-consent__feature-text">
              <h4 className="nexus-consent__feature-title">Terms & Notices</h4>
              <p className="nexus-consent__feature-desc">
                <a href="#" className="nexus-consent__link" onClick={(e) => e.preventDefault()}>Terms</a> and the{' '}
                <a href="#" className="nexus-consent__link" onClick={(e) => e.preventDefault()}>Privacy Notice</a> apply. AI agents can make mistakes, so double-check it.
              </p>
            </div>
          </div>
        </div>

        {/* Disclaimer */}
        <p className="nexus-consent__disclaimer">
          Available WebMCP tools enables AI agents to perform actions quicker.{' '}
          <a href="#" className="nexus-consent__link" onClick={(e) => e.preventDefault()}>
            Learn more about tools and WebMCP
          </a>
        </p>

        {/* Action Buttons */}
        <div className="nexus-consent__actions">
          <button className="nexus-consent__btn nexus-consent__btn--secondary" onClick={onClose}>
            Close
          </button>
          <button className="nexus-consent__btn nexus-consent__btn--primary" onClick={onGotIt}>
            Got it
          </button>
        </div>
      </main>
    </div>
  );
}

export default NexusConsentScreen;

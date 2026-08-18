/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { SymbolIcon, AtomLogo } from '../components/Icons';

export interface ConsentScreenProps {
  onGotIt?: () => void;
  onClose?: () => void;
}

/**
 * ConsentScreen Component
 * Reuses the welcome card layout with identical "Hi there!" heading & subtitle styling.
 */
export function ConsentScreen({ onGotIt, onClose }: ConsentScreenProps) {
  return (
    <div className="consent-view view">
      <div className="consent__content welcome-card">
        {/* Welcome Greeting Header matching Figma design */}
        <div className="consent__header">
          <div className="consent__header-icon">
            <AtomLogo size={36} color="#001944" />
          </div>
          <h1 className="welcome-title consent__title">Hi there!</h1>
          <p className="welcome-subtitle consent__subtitle">
            Get help with your tabs and tasks with ‘Agent’
          </p>
        </div>

        {/* Feature List Container */}
        <div className="consent__feature-card">
          {/* Feature 1 */}
          <div className="consent__feature-item">
            <div className="consent__feature-icon">
              <SymbolIcon name="automation" size={20} color="#012c6f" />
            </div>
            <div className="consent__feature-text">
              <h4 className="consent__feature-title">Reach your goals, faster</h4>
              <p className="consent__feature-desc">
                Get things done faster by using WebMCP provided by the site
              </p>
            </div>
          </div>

          {/* Feature 2 */}
          <div className="consent__feature-item">
            <div className="consent__feature-icon">
              <SymbolIcon name="tab" size={20} color="#012c6f" />
            </div>
            <div className="consent__feature-text">
              <h4 className="consent__feature-title">Use it on trusted sites</h4>
              <p className="consent__feature-desc">You may share personal info with the sites</p>
            </div>
          </div>

          {/* Feature 3 */}
          <div className="consent__feature-item">
            <div className="consent__feature-icon">
              <SymbolIcon name="shield" size={20} color="#012c6f" />
            </div>
            <div className="consent__feature-text">
              <h4 className="consent__feature-title">Stay in control</h4>
              <p className="consent__feature-desc">
                Shows the steps when appropriate and asks confirmations before the sensitive ones
              </p>
            </div>
          </div>

          {/* Feature 4 */}
          <div className="consent__feature-item">
            <div className="consent__feature-icon">
              <SymbolIcon name="description" size={20} color="#012c6f" />
            </div>
            <div className="consent__feature-text">
              <h4 className="consent__feature-title">Terms &amp; Notices</h4>
              <p className="consent__feature-desc">
                <a href="#" className="consent__link" onClick={(e) => e.preventDefault()}>
                  Terms
                </a>{' '}
                and the{' '}
                <a href="#" className="consent__link" onClick={(e) => e.preventDefault()}>
                  Privacy Notice
                </a>{' '}
                apply. AI agents can make mistakes, so double-check it.
              </p>
            </div>
          </div>
        </div>

        {/* Disclaimer */}
        <p className="consent__disclaimer">
          Available WebMCP tools enables AI agents to perform actions quicker.{' '}
          <a href="#" className="consent__link" onClick={(e) => e.preventDefault()}>
            Learn more about tools and WebMCP
          </a>
        </p>

        {/* Action Buttons */}
        <div className="consent__actions">
          <button className="consent__btn consent__btn--secondary" onClick={onClose}>
            Close
          </button>
          <button className="consent__btn consent__btn--primary" onClick={onGotIt}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConsentScreen;

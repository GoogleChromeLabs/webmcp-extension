import React from 'react';
import { ActionsChip } from './ActionsChip.jsx';
import { Favicon, FaviconStack } from './Favicon.jsx';
import { CloseIcon, ArrowDownIcon, ArrowUpIcon } from './Icons.jsx';

/**
 * AttachedTab (Attached tab Final) Component
 * WebMCP Figma Node ID: 3385:29141 ("Attached tab Final")
 *
 * Variants:
 *  - property1: "Single" | "Multiple"
 *  - property2: "No tools" | "With tools" | "With tools closed" | "With tools open"
 */
export function AttachedTab({
  property1 = 'Single',
  property2 = 'With tools',
  domain = 'lightroom.adobe.com',
  faviconUrl,
  toolsCountLabel = 'automation',
  onClose,
  onToggleExpand,
  className = ''
}) {
  const isMultiple = property1 === 'Multiple';
  const isOpen = property2 === 'With tools open';
  const hasTools = property2 === 'With tools' || property2 === 'With tools closed' || property2 === 'With tools open';

  const classNames = ['nexus-attached-tab'];
  if (isMultiple) classNames.push('nexus-attached-tab--multiple');
  if (isOpen) classNames.push('nexus-attached-tab--open');
  if (className) classNames.push(className);

  return (
    <div
      className={classNames.join(' ')}
      data-node-id="3385:29141"
      data-name="Attached tab Final"
      data-property1={property1}
      data-property2={property2}
    >
      {/* Top Main Row */}
      <div className="nexus-attached-tab__main-row">
        {/* Left Section: Favicon(s) + Meta Domain + ActionsChip (Left Aligned!) */}
        <div className="nexus-attached-tab__left-group">
          <div className="nexus-attached-tab__left">
            {isMultiple ? (
              <FaviconStack activeType="lightroom" />
            ) : (
              <Favicon property1="lightroom" customSrc={faviconUrl} />
            )}
            <span className="nexus-attached-tab__meta">{domain}</span>
          </div>

          {hasTools && (
            <ActionsChip
              state={isOpen ? 'Hover' : 'Closed'}
              label={toolsCountLabel}
              onClick={onToggleExpand}
            />
          )}
        </div>

        {/* Right Section: Chevron or Close Button */}
        <div className="nexus-attached-tab__right">
          {isMultiple ? (
            <button
              className="nexus-attached-tab__chevron-btn"
              onClick={onToggleExpand}
              title={isOpen ? 'Collapse tabs' : 'Expand tabs'}
            >
              {isOpen ? <ArrowUpIcon size={16} color="#444746" /> : <ArrowDownIcon size={16} color="#444746" />}
            </button>
          ) : (
            <button
              className="nexus-attached-tab__close-btn"
              onClick={onClose}
              title="Close tab"
            >
              <CloseIcon size={20} color="#444746" />
            </button>
          )}
        </div>
      </div>

      {/* Expanded Multi-Tab List (only when Property 1=Multiple, Property 2=With tools open) */}
      {isOpen && (
        <div className="nexus-attached-tab__expanded-list">
          <div className="nexus-attached-tab__row">
            <div className="nexus-attached-tab__left-group">
              <div className="nexus-attached-tab__left">
                <Favicon type="opentable" />
                <span className="nexus-attached-tab__meta">
                  Opentable.com | Restaurants &amp; Restaurant booking
                </span>
              </div>
              <ActionsChip state="Closed" />
            </div>
          </div>

          <div className="nexus-attached-tab__row">
            <div className="nexus-attached-tab__left-group">
              <div className="nexus-attached-tab__left">
                <Favicon type="booking" />
                <span className="nexus-attached-tab__meta">
                  Booking.com | Official site | The best hotels, flights...
                </span>
              </div>
              <ActionsChip state="Closed" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AttachedTab;

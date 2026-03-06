import React from 'react';
import './BottomControls.css';

// Pre-create an Image using the pin SVG so we can use it as the drag image.
const pinSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24">
  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="#FF5252" stroke="none"/>
  <circle cx="12" cy="9" r="2.2" fill="#ffffff" />
</svg>`;
const pinDragImage = new Image();
pinDragImage.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(pinSvg);

function BottomControls({ onFilterClick, onAccountClick, pinMode, onPinToggle }) {
  const onPinDragStart = (e) => {
    // Indicate drag type so the map can accept the drop
    try {
      e.dataTransfer.setData('text/pin', 'pin');
      // Use our pre-created SVG image so the drag ghost is just the pin.
      if (pinDragImage && pinDragImage.complete) {
        e.dataTransfer.setDragImage(pinDragImage, 16, 16);
      } else if (pinDragImage) {
        // If image not yet loaded, set a one-time onload to apply it.
        const img = pinDragImage;
        const handler = () => {
          try { e.dataTransfer.setDragImage(img, 16, 16); } catch (err) {}
          img.removeEventListener('load', handler);
        };
        img.addEventListener('load', handler);
      }
    } catch (err) {
      // some browsers may block access in strict contexts
    }
  };

  /**
   * On touch devices the HTML5 Drag & Drop API is not supported, so tapping the
   * pin button toggles "pin drop mode". The next tap on the map sets the destination.
   * On desktop, dragging still works as before.
   */
  const handlePinClick = () => {
    if (onPinToggle) onPinToggle();
  };

  return (
    <div className="bottom-controls">
      <button
        className="control-btn"
        title="Filter Options"
        onClick={onFilterClick}
        aria-label="Open filter options"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <line x1="4" y1="6" x2="20" y2="6" strokeWidth="2"/>
          <line x1="4" y1="12" x2="20" y2="12" strokeWidth="2"/>
          <line x1="4" y1="18" x2="20" y2="18" strokeWidth="2"/>
          <circle cx="7" cy="6" r="2" fill="white" strokeWidth="2"/>
          <circle cx="14" cy="12" r="2" fill="white" strokeWidth="2"/>
          <circle cx="17" cy="18" r="2" fill="white" strokeWidth="2"/>
        </svg>
        <span>Filter</span>
      </button>
      
      <button className="control-btn" title="Center on My Location">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="12" cy="12" r="3" strokeWidth="2"/>
          <line x1="12" y1="2" x2="12" y2="6" strokeWidth="2"/>
          <line x1="12" y1="18" x2="12" y2="22" strokeWidth="2"/>
          <line x1="2" y1="12" x2="6" y2="12" strokeWidth="2"/>
          <line x1="18" y1="12" x2="22" y2="12" strokeWidth="2"/>
        </svg>
        <span>My Location</span>
      </button>
      
      <button
        className="control-btn"
        title="Account"
        onClick={onAccountClick}
        aria-label="Open account menu"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="12" cy="8" r="4" strokeWidth="2"/>
          <path d="M4 20c0-4 4-6 8-6s8 2 8 6" strokeWidth="2"/>
        </svg>
        <span>Account</span>
      </button>

      <button
        className={`control-btn pin-btn${pinMode ? ' pin-active' : ''}`}
        title={pinMode ? 'Tap the map to drop pin (tap again to cancel)' : 'Tap to place pin on map, or drag to map'}
        draggable
        onDragStart={onPinDragStart}
        onClick={handlePinClick}
        aria-label={pinMode ? 'Cancel pin drop mode' : 'Place pin on map to set destination'}
        aria-pressed={pinMode}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" strokeWidth="1.5" fill="#FF5252" />
          <circle cx="12" cy="9" r="2.2" fill="#fff" strokeWidth="1" />
        </svg>
        <span>Pin</span>
      </button>
    </div>
  );
}

export default BottomControls;

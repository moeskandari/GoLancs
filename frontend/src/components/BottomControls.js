
import { useRef } from 'react';
import './BottomControls.css';


// Pre-create an Image using the pin SVG so we can use it as the drag image.
const pinSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24">
  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="#FF5252" stroke="none"/>
  <circle cx="12" cy="9" r="2.2" fill="#ffffff" />
</svg>`;
const pinDragImage = new Image();
pinDragImage.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(pinSvg);

function BottomControls({ onFilterClick, onAccountClick, pinMode, onPinToggle, onSettingsClick }) {
  const touchStartRef = useRef(null);
  const touchMovedRef = useRef(false);

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
    // If this was a touch-drag gesture, do not toggle tap-to-pin mode.
    if (touchMovedRef.current) {
      touchMovedRef.current = false;
      return;
    }
    if (onPinToggle) onPinToggle();
  };

  const handlePinTouchStart = (e) => {
    const t = e.touches?.[0];
    if (!t) return;
    touchStartRef.current = { x: t.clientX, y: t.clientY };
    touchMovedRef.current = false;
    window.__pinTouchDragActive = true;
    window.__pinTouchDragMoved = false;
  };

  const handlePinTouchMove = (e) => {
    const t = e.touches?.[0];
    const s = touchStartRef.current;
    if (!t || !s) return;
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.hypot(dx, dy) > 8) {
      touchMovedRef.current = true;
      window.__pinTouchDragMoved = true;
    }
  };

  const handlePinTouchEnd = () => {
    touchStartRef.current = null;
    // Allow map touchend handler a moment to process drop target
    setTimeout(() => {
      window.__pinTouchDragActive = false;
      window.__pinTouchDragMoved = false;
    }, 120);
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

      <button
        className="control-btn"
        title="Settings"
        onClick={onSettingsClick}
        aria-label="Open settings"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M19.43 12.98c.04-.32.07-.65.07-.98s-.03-.66-.08-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46a.5.5 0 0 0-.6-.22l-2.49 1a7.03 7.03 0 0 0-1.69-.98l-.38-2.65A.5.5 0 0 0 14 2h-4a.5.5 0 0 0-.49.42l-.38 2.65c-.61.24-1.18.56-1.69.98l-2.49-1a.5.5 0 0 0-.6.22l-2 3.46a.5.5 0 0 0 .12.64l2.11 1.65c-.05.32-.08.65-.08.98s.03.66.08.98l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46c.13.22.39.31.6.22l2.49-1c.51.41 1.08.74 1.69.98l.38 2.65A.5.5 0 0 0 10 22h4a.5.5 0 0 0 .49-.42l.38-2.65c.61-.24 1.18-.57 1.69-.98l2.49 1c.22.09.47 0 .6-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.1-1.65ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z" />
        </svg>
        <span>Settings</span>
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
        title={pinMode ? 'Tap the map to drop pin (tap again to cancel)' : 'Tap or drag pin onto map to set selected start/destination field'}
        draggable
        onDragStart={onPinDragStart}
        onTouchStart={handlePinTouchStart}
        onTouchMove={handlePinTouchMove}
        onTouchEnd={handlePinTouchEnd}
        onClick={handlePinClick}
        aria-label={pinMode ? 'Cancel pin drop mode' : 'Place pin on map to set selected start or destination'}
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

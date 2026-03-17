import { useState, useRef, useEffect } from 'react';
import './OptimizedImage.css';

/**
 * OptimizedImage — A mobile-friendly image component that provides:
 *   • Lazy loading via IntersectionObserver (loads images only when near the viewport)
 *   • Responsive srcSet support for serving smaller images on small screens
 *   • Smooth fade-in transition on load for perceived performance
 *   • Fallback placeholder while loading
 *   • Automatic width/height to prevent layout shift (CLS)
 *
 * Usage:
 *   <OptimizedImage
 *     src="/images/map-preview.jpg"
 *     alt="Route preview"
 *     width={400}
 *     height={300}
 *     srcSet="/images/map-preview-sm.jpg 400w, /images/map-preview.jpg 800w"
 *     sizes="(max-width: 480px) 100vw, 400px"
 *   />
 */
function OptimizedImage({
  src,
  alt = '',
  width,
  height,
  srcSet,
  sizes,
  className = '',
  placeholder = null,
  ...rest
}) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isInView, setIsInView] = useState(false);
  const imgRef = useRef(null);

  useEffect(() => {
    // Use IntersectionObserver for lazy loading — only load the image when
    // it's within 200px of the viewport (rootMargin gives a buffer).
    if (!imgRef.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(imgRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={imgRef}
      className={`optimized-image-wrapper ${className}`}
      style={{
        width: width ? `${width}px` : '100%',
        aspectRatio: width && height ? `${width} / ${height}` : undefined,
      }}
    >
      {!isLoaded && (
        <div className="optimized-image-placeholder">
          {placeholder || <div className="optimized-image-skeleton" />}
        </div>
      )}
      {isInView && (
        <img
          src={src}
          alt={alt}
          width={width}
          height={height}
          srcSet={srcSet}
          sizes={sizes}
          loading="lazy"
          decoding="async"
          className={`optimized-image ${isLoaded ? 'loaded' : ''}`}
          onLoad={() => setIsLoaded(true)}
          {...rest}
        />
      )}
    </div>
  );
}

export default OptimizedImage;

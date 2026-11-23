import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { scrollAndFocusSection } from '@/utils/navigateToSection';

const RETRY_DELAYS = [50, 100, 200, 300, 350];

function tryScrollToElement(id: string): boolean {
  if (!document.querySelector(`#${CSS.escape(id)}`)) return false;
  requestAnimationFrame(() => {
    scrollAndFocusSection(id);
  });
  return true;
}

function scheduleScrollRetries(id: string): () => void {
  const timeouts: Array<ReturnType<typeof setTimeout>> = [];
  for (const delay of RETRY_DELAYS) {
    timeouts.push(
      setTimeout(() => {
        if (tryScrollToElement(id)) {
          timeouts.forEach(clearTimeout);
        }
      }, delay),
    );
  }
  return () => {
    timeouts.forEach(clearTimeout);
  };
}

/**
 * Handles scrolling to hash fragments after cross-page navigation.
 * Uses retry pattern to wait for target element to be in the DOM.
 */
const ScrollToHash = () => {
  const { hash, pathname } = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!hash) return;
    const id = hash.slice(1);
    if (id === 'pricing' && pathname !== '/pricing' && !document.querySelector('#pricing')) {
      navigate('/pricing', { replace: true });
      return;
    }
    if (tryScrollToElement(id)) return;
    return scheduleScrollRetries(id);
  }, [hash, pathname, navigate]);

  return null;
};

export default ScrollToHash;

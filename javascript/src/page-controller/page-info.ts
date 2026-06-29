/**
 * Page info utilities: viewport, scroll position, page dimensions.
 * Adapted from @page-agent/page-controller (MIT License).
 */

export interface PageScrollInfo {
  viewport_width: number;
  viewport_height: number;
  page_width: number;
  page_height: number;
  scroll_x: number;
  scroll_y: number;
  pixels_above: number;
  pixels_below: number;
  pages_above: number;
  pages_below: number;
  total_pages: number;
  current_page_position: number;
  pixels_left: number;
  pixels_right: number;
}

export function getPageScrollInfo(): PageScrollInfo {
  const viewport_width = window.innerWidth;
  const viewport_height = window.innerHeight;

  const page_width = Math.max(
    document.documentElement.scrollWidth,
    document.body.scrollWidth || 0
  );
  const page_height = Math.max(
    document.documentElement.scrollHeight,
    document.body.scrollHeight || 0
  );

  const scroll_x =
    window.scrollX ||
    window.pageXOffset ||
    document.documentElement.scrollLeft ||
    0;
  const scroll_y =
    window.scrollY ||
    window.pageYOffset ||
    document.documentElement.scrollTop ||
    0;

  const pixels_below = Math.max(
    0,
    page_height - (window.innerHeight + scroll_y)
  );
  const pixels_right = Math.max(
    0,
    page_width - (window.innerWidth + scroll_x)
  );

  return {
    viewport_width,
    viewport_height,
    page_width,
    page_height,
    scroll_x,
    scroll_y,
    pixels_above: scroll_y,
    pixels_below,
    pages_above: viewport_height > 0 ? scroll_y / viewport_height : 0,
    pages_below: viewport_height > 0 ? pixels_below / viewport_height : 0,
    total_pages: viewport_height > 0 ? page_height / viewport_height : 0,
    current_page_position:
      scroll_y / Math.max(1, page_height - viewport_height),
    pixels_left: scroll_x,
    pixels_right,
  };
}

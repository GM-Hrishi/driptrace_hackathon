import { useEffect } from 'react'
import { useLocation } from 'react-router'

/** Routes that render in light mode. Everything else is the dark ward view. */
const LIGHT_ROUTES = ['/admin', '/setup']

/**
 * Theme follows the route, not the OS: the live ward view is dark so it does
 * not glare in a dim ward, and admin/setup screens are light because they are
 * read at a desk. index.html ships data-theme="dark" so the ward view paints
 * correctly on first frame with no flash.
 */
export function useRouteTheme() {
  const { pathname } = useLocation()

  useEffect(() => {
    const light = LIGHT_ROUTES.some((route) => pathname.startsWith(route))
    document.documentElement.dataset.theme = light ? 'light' : 'dark'
  }, [pathname])
}

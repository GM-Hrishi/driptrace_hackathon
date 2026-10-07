import { useEffect } from 'react'
import { useLocation } from 'react-router'

/** Routes that render in light mode. Everything else, Admin included, is dark. */
const LIGHT_ROUTES = ['/setup']

/**
 * Theme follows the route, not the OS: the live ward view and Admin are dark,
 * so moving between them in a dim ward never flashes a bright screen.
 * index.html ships data-theme="dark" so the first frame paints correctly.
 */
export function useRouteTheme() {
  const { pathname } = useLocation()

  useEffect(() => {
    const light = LIGHT_ROUTES.some((route) => pathname.startsWith(route))
    document.documentElement.dataset.theme = light ? 'light' : 'dark'
  }, [pathname])
}

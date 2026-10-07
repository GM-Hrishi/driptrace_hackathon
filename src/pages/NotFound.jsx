import { NavLink } from 'react-router'

export default function NotFound() {
  return (
    <section className="mx-auto max-w-md py-16 text-center">
      <p className="dt-nums text-[13px] tracking-widest text-ink-subtle uppercase">Error 404</p>
      <h1 className="mt-3 text-2xl">This page is not part of DripTrace</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">
        The address you opened does not match any ward, bed or setup screen.
      </p>
      <NavLink
        to="/"
        className="rounded-pill bg-accent text-accent-on hover:bg-accent-hover mt-7 inline-block px-5 py-2.5 text-sm font-medium transition-colors"
      >
        Back to the ward
      </NavLink>
    </section>
  )
}

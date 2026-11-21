# Parhiba web standards

## Code architecture

- Keep SvelteKit routes focused on a screen. Read URL parameters, resolve the current language and user, and load page data in `+page.server.ts`. Render it in `+page.svelte`. Give alternate routes for the same screen a shared loader or view where their behavior overlaps. The recent and all-books Library routes are an example.
- Type route components with the generated `PageProps` or `LayoutProps` from their own `./$types`. This keeps the view aligned with the loader and form actions. [SvelteKit loading data](https://svelte.dev/docs/kit/load)
- Read the current route from `$app/state` and use `$derived` for values that should update on navigation. SvelteKit can reuse a page or layout when its inputs change. [SvelteKit page state](https://svelte.dev/docs/kit/$app-state)
- Create shared mutable UI state in the layout or component that owns its lifetime. Pass it to descendants through typed Svelte context and to ordinary functions as an argument. The root layout owns the notification queue so it survives client navigation and each server render gets a fresh queue. [Svelte context](https://svelte.dev/docs/svelte/context) and [SvelteKit state management](https://svelte.dev/docs/kit/state-management)
- Put database queries, permission checks, and mutations under `apps/web/src/lib/server`, grouped by feature. Page actions and API handlers should call the same operation when they perform the same edit. Enforce access in the server operation or its authorized entry point.
- Keep route-specific components beside their route. Put reusable interaction controls under `$lib/components/input`, page navigation and layout under `$lib/components/shell`, and feature widgets such as `BookActions` with their feature components. Share appearance across tables in `$lib/styles/entry-table.css`.
- Keep shareable list state, including pagination and active search filters, in the URL. Preserve filters when paging and return to the first page when a filter changes. Use local state for transient interactions such as an open menu.
- Check changes with `pnpm --filter @ciareader/web check` and `pnpm --filter @ciareader/web lint`. Exercise the affected route or component tests. For interaction and layout changes, verify the affected control with a keyboard and at a narrow viewport.

## Design

| Interaction | Standard |
| --- | --- |
| Page layout | Pass the route’s heading snippet to `PageLayout` for the mobile bar and render that snippet in the desktop content. Use `PageTitle` for the main heading. The reader owns its full-screen layout. |
| Return to a parent page | Put the X before the title using `SubpageHeading`. Supply the parent URL and an accessible label naming the destination. A direct link to a subpage should close to the same parent as a visit from within the app. Custom headers such as the reader can use `PageCloseLink` directly. |
| Buttons and choices | Use `Button` with an `href` for navigation and a button for actions. Use `SegmentedControl` for mutually exclusive settings and pressed toggle buttons for independent filters. |
| Tables that open an item | Give each row one native link in its title cell. Use `linked-row` and `row-link` to extend that link over the row. Use ordinary text styling for the title, row highlighting on hover, and a visible keyboard focus outline. Keep secondary actions above the link hit area and independently operable. |
| Table sizing | Let long titles wrap. Reserve enough width for short headers such as Actions to fit on one line at mobile widths. |
| Secondary book actions | Use the vertical three-dot `BookActions` menu for publishing and deletion. Keep the menu usable over adjacent rows in both themes. |
| Pagination | Use `Pagination` for lists, with Previous, Next, and the page number. Include the page count when available. Reader page turns and chapter navigation have their own controls. |
| Color and copy | Use the theme's text, surface, border, and focus colors. Keep labels short, give icon-only controls accessible names, and add explanatory sections only when requested. |

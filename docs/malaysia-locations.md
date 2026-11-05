# Malaysian location dropdowns

The browse controls are State / federal territory → **Nama tempat** (town / area) → Visit status. Changing the state clears the town selection. The location bubbles and browse category filter have been removed. Categories remain part of each saved place.

`public/js/locations.js` contains 447 state-specific town and district options across all 13 states and 3 federal territories. The same list supplies the save form's town suggestions. It is bundled with the offline app shell and does not require a location API call.

## Sources and attribution

- Malaysian Communications and Multimedia Commission (MCMC), [Postcode Dataset](https://data.gov.my/data-catalogue/poskod), data as of June 2026. [CSV](https://storage.data.gov.my/dictionaries/postcodes.csv), 2,932 rows. Unique state/city pairs are used; postcode values are not included in the app.
- Department of Statistics Malaysia (DOSM), [Population Table: Administrative Districts](https://open.dosm.gov.my/data-catalogue/population_district), 2020–2026. [CSV](https://storage.dosm.gov.my/population/population_district.csv). Unique state/district pairs extend coverage beyond postcode towns.

Both datasets are licensed under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/). Downloaded and checked on 5 November 2026. Attribution is also available in the app's Settings.

## Changes to the source data

State and town names are trimmed, deduplicated without regard to case, and alphabetized. The duplicate `Negeri Sembilan  ` state and `Bestari Jaya ` town are merged. `Klia` is displayed as `KLIA`; the postcode source's `Kota Kinbatangan` is normalized to DOSM's `Kinabatangan`. The existing `Melaka City` suggestion is retained and `George Town` is added as the familiar city name.

For compatibility with existing records, the stored state value `Penang` is retained and displayed as `Pulau Pinang`. Federal territory labels use `W.P.` while their stored values remain `Kuala Lumpur`, `Labuan`, and `Putrajaya`.

This is a national town/district list, not an exhaustive gazetteer of every village or neighbourhood. Saved custom areas (for example Permas Jaya) are added to the appropriate state dropdown automatically; users can still type a new town/area when saving a place. A town shared by several states, such as Ayer Hitam, never guesses a state in the editor. In Trash, deleted custom towns are available for filtering too.

// Set while the board itself moves cards between lanes, so those moves are not written back to
// the ticket. Kept in its own module so lane logic can be unit-tested without the canvas bundle.
export const laneWrites = { suppressed: false }

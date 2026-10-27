// Board templates offered when creating a board. Kept free of tldraw imports so the Boards list
// page does not pull the canvas bundle in. The layouts themselves live in lanes.js.
export const TEMPLATE_OPTIONS = [
  ['blank', 'Blank', 'Start from nothing'],
  ['weekly', 'Weekly plan', 'Mon → Sun lanes. Dropping a card sets its due date'],
  ['status', 'Status lanes', 'Backlog → Done. Dropping a card moves its status'],
  ['roadmap', 'Roadmap', 'Now / Next / Later lanes that set due dates'],
  ['brainstorm', 'Brainstorm', 'Ideas · Keep · Later · Parking lot'],
  ['retro', 'Retro', 'Went well · Didn’t · Actions · Kudos'],
]
export const templateKey = boardId => `basira_board_template:${boardId}`

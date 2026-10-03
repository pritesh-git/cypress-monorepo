const SELECTORS = {
  NAV_CONTAINER: '.navbar > .container',
  NAV_LINK: (index) => `.nav > :nth-child(${index}) > a`,
  MAIN_TITLE: 'h1',
  GRID_MENU_ASC: '#menuitem-0 > .ui-grid-menu-item',
  GRID_MENU_DESC: '#menuitem-1 > .ui-grid-menu-item',
  GRID_ICON_DOWN: '.ui-grid-icon-angle-down',
};

module.exports = { SELECTORS };
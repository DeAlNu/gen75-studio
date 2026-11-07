export interface PhysicalKey {
  index: number;
  row: number;
  col: number;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  option: { group: number; choice: number } | null;
  encoder: number | null;
}

export interface ValueRef {
  id: string;
  channel: number;
  valueId: number;
}

interface ControlBase {
  label: string;
  showIf: string | null;
  ref: ValueRef;
}

export interface RangeControl extends ControlBase {
  kind: 'range';
  min: number;
  max: number;
}

export interface DropdownControl extends ControlBase {
  kind: 'dropdown';
  options: { label: string; value: number }[];
}

export interface ColorControl extends ControlBase {
  kind: 'color';
}

export interface ToggleControl extends ControlBase {
  kind: 'toggle';
}

export type MenuControl = RangeControl | DropdownControl | ColorControl | ToggleControl;

export interface MenuGroup {
  kind: 'group';
  label: string;
  showIf: string | null;
  items: MenuNode[];
}

export type MenuNode = MenuGroup | MenuControl;

export interface CustomKeycode {
  name: string;
  title: string;
  shortName: string;
}

export interface LayoutOption {
  group: number;
  label: string;
  choices: number;
}

export interface DeviceDefinition {
  name: string;
  vendorId: number;
  productId: number;
  matrix: { rows: number; cols: number };
  keys: PhysicalKey[];
  width: number;
  height: number;
  menus: MenuGroup[];
  customKeycodes: CustomKeycode[];
  layoutOptions: LayoutOption[];
}

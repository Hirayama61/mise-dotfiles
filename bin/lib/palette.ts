export const PANDA = {
  bg: '36 37 38',
  bgDim: '41 42 43',
  fg: '230 230 230',
  white: '255 255 255',
  selection: '62 66 80',
  subtle: '103 107 121',
  pink: '255 117 181',
  mint: '25 249 216',
  orange: '255 184 108',
  red: '255 75 130',
  blue: '69 169 249',
  cyan: '111 193 255',
  blueLift: '149 208 255',
  purpleLift: '205 191 255',
  grayLift: '164 168 184',
} as const;

export type PandaColor = (typeof PANDA)[keyof typeof PANDA];

declare module "*.module.css" { const classes: Readonly<Record<string, string>>; export default classes; }
declare module "*.svg" { const url: string; export default url; }
declare module "*.css" {}

/* Leader-line callouts anchored to the posed surface.
   Placeholder: the analysis agent replaces this module.

   new Callouts(layer: HTMLElement over the canvas, stage: Stage)
   callouts.update(figures: Freeman[], trait: key, metrics: object[])  // once per edit
   callouts.frame()                                                    // once per rendered frame
   callouts.visible = boolean */
export class Callouts {
  constructor(layer, stage) {
    this.layer = layer;
    this.stage = stage;
    this.visible = true;
  }
  update() {}
  frame() {}
}

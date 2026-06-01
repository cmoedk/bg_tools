/**
 * @module
 * @typedef {{
 *    id: string, 
 *    quantity: number,  
 *    text: string, 
 *    back?: string,
 * }} Card
 * 
 * @typedef {{batch_name: string, back?: string, width?: number, height?: number, backText?: string }} BatchSetup - Width is mm, height is mm
 
 * @typedef {Object} CardBatch
 * @property {string} [_back] - Optional single back design.
 * @property {number} [_width_mm] - Optional card width in mm
 * @property {number} [_height_mm] - Optional card height in mm
 * @property {Object.<string, string>} [_backs] - Optional map of backs.
 * @property {Object.<string, number>} [otherProps] - Other dynamic properties with number values.
 
 * @typedef {{ cards?: string, backs?: string }} Errata

 * @typedef {Object.<string, CardBatch>} AppData
 * @typedef {Object.<string, string | ImageText[]>} CardData
 * @property {Errata} [_errata] - Optional errata for single prints.
 
 
 * @typedef {{
    cardId: string,
    backCardId: string,
    batch: string,
    path: string, 
    backPath: string, 
    notFound: boolean, 
    widthPx: number, 
    heightPx: number, 
    targetWidthMm: number, 
    targetHeightMm: number,

    buffer?: Buffer,
    backBuffer?: Buffer,
    }} ImageInfo

 * @typedef {{ 
      text: string, 
      fontSize?: number, 
      font?: string, 
      color?: string 
      bold?: boolean
   }} ImageText 

   
 * @typedef  {Object}   PDFImageBufferGroup
 * @property {number}   widthPt
 * @property {number}   heightPt
 * @property {Buffer[]} buffers
 * 
 * 
 *  
 */


export { };

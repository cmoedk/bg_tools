// FOLDERS
export const DIST_DIR = './_dist/';
export const TTS_SUBFOLDER = 'tts/';
export const PNP_PDF_SUBFOLDER = 'pnp_pdf/';
export const BGM_SUBFOLDER_FRONTS = 'bgm/fronts/';
export const BGM_SUBFOLDER_BACKS = 'bgm/backs/';
export const TEST_PNP_PDF_SUBFOLDER = 'test';
export const TEMPLATE_JPG_SUBFOLDER = 'template_jpg';

// GLOBAL CONFIGS
export const DEFAULT_CARD_MM_HEIGHT = 86.4306;
export const DEFAULT_CARD_MM_WIDTH = 57.6204;
export const DEFAULT_BACK_FILENAME_APPEND = 'b'; // Automatically searches for card backgrounds with this appended, so it does not need to be specified in the card itself.
export const IMG_EXT = 'jpg'; // We only support jpg, because PDF generation takes about 100 times longer with pngs.

// PDF PRINT AND PLAYER CONFIGS
export const PNP_PDF_DRAW_CUT_LINES = true;
export const A4_WIDTH_PT = 595; 
export const A4_HEIGHT_PT = 842;

// TABLETOP SIMULATOR CONFIGS
export const MAX_TTS_WIDTH_PX = 10_000;
export const MAX_IMAGES = 70;



// TEST CARD GENERATION
export const TEST_DEFAULT_CARD_WIDTH_PX = 750;
export const TEST_DEFAULT_CARD_HEIGHT_PX = 1125;

import { FILMS } from "./films";

/**
 * The short film, on our own media host under a fixed name, so a new cut replaces the file and every link keeps
 * working (Max, 11 November 2026: no new upload to YouTube; the old YouTube copy stays as it is). Its length is in
 * films.ts, written by the video publish script.
 */
export const OVERVIEW_VIDEO_URL = FILMS.overview.src;

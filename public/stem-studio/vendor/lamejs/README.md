# lamejs 1.2.1 (vendored, unmodified)

MP3 encoder (a JavaScript port of LAME) by Alex Zhukov. Source: https://github.com/zhuker/lamejs (npm: `lamejs@1.2.1`).
Licence: **LGPL-3.0** (see LICENSE and the LAME licence referenced there).

It is shipped as a separate, unmodified file (`lame.min.js`) and only loaded when the user exports MP3, so it can be
replaced by any other build of lamejs. Beez: LGPL needs the notice above and a way to swap the library - both are satisfied -
but if you want zero LGPL surface, delete this folder; WAV export keeps working and the MP3 option hides itself.

Acknowledgement (required by the LAME licence terms): MP3 encoding by LAME - http://lame.sourceforge.net/ (shown in the export panel).

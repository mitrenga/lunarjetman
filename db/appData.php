<?php

class DataCommand {

  // Co se posílá při startu aplikace. Všechno jsou to soubory vytažené
  // z originálu, každý má svůj nástroj (data/README.md):
  //
  // - `global`   – snímek tabulky entit $6000–$623F z běžícího originálu
  //                (tools/mkglobal.py)
  // - `sprites`  – 209 předloh z tabulky $BAC0 a 30 nepřátel z $EE7A
  //                (tools/dumpsprites.py)
  // - `font`     – vlastní znaková sada hry z $D347; hra netiskne ROM fontem
  //                Spectra, takže bez tohohle souboru se nevykreslí ani panel
  //                (tools/dumpfont.py)
  // - `screen`   – zachycená statická herní obrazovka, zatím pozadí hrací
  //                plochy (tools/mkscene.py)
  // - `terrain`  – dlaždice a mapa měsíční krajiny (tools/dumpterrain.py)
  // - `panel`    – rozvržení panelu se skóre (tools/dumppanel.py)
  // - `menu`     – rozvržení menu GAME SELECTION (tools/dumpmenu.py)
  // - `texts`    – texty hry (tools/dumptext.py)
  // - `sounds`   – deset zvukových rutin v T-stavech (tools/tracesound.py)
  // - `loading`  – loading screen z kazety pro variantu spuštění LOAD TAPE
  //                (tools/mkscreen.py)
  //
  // Chybějící soubor dorazí jako `null` a aplikace to musí přežít – přibývají
  // po milnících, jak se co změří.
  var $files = ['global', 'sprites', 'font', 'screen', 'terrain', 'panel',
                'menu', 'texts', 'sounds', 'loading'];

  public function execute($postData) {
    $result = [];
    foreach ($this->files as $file) {
      $fileName = 'data/'.$file.'.json';
      if (!is_file($fileName)) {
        // optional data files (those a later milestone adds) arrive as null
        $result[$file] = null;
        continue;
      }
      $dataJSON = file_get_contents($fileName);
      try {
        $result[$file] = json_decode($dataJSON, false, 512, JSON_THROW_ON_ERROR);
      }
      catch (\JsonException $exception) {
        $result[$file] = ['error' => ['message' => $exception->getMessage()]];
      }
    }

    // Nejvyšší skóre ze síně slávy. ★ Síň slávy má i originál (THE ULTIMATE
    // HALL OF FAME, $F4AA), takže je to věrnost, ne přídavek.
    //
    // Když databáze není (čerstvá instalace, nespuštěné config/createDB.sql),
    // **nesmí to shodit celý appData** – jinak aplikace hlásí „Game data could
    // not be loaded“ a nedá se ani do menu.
    $result['hiScore'] = 0;
    try {
      $mysqli = @new mysqli($GLOBALS['dbHostname'], $GLOBALS['dbUser'], $GLOBALS['dbPassword'], $GLOBALS['dbName']);
      if (!$mysqli->connect_errno) {
        $data = @$mysqli->query('SELECT `score` FROM `rg_ljm_hallOfFame` ORDER BY `score` DESC LIMIT 1');
        if ($data && ($row = $data->fetch_object())) {
          $result['hiScore'] = $row->score;
        }
        $mysqli->close();
      }
    }
    catch (\Throwable $exception) {
      // síň slávy je nepodstatná pro spuštění hry; hiScore zůstane nula
    }

    return $result;
  } // execute

} // class DataCommand

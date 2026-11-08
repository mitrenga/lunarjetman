<?php

require_once 'app/svision/php/abstractAboutPage.php';

/**
 * The /about page: the story of the original Lunar Jetman and of this remake.
 * M1 text; the final content comes with M7.
 */
class AboutPage extends AbstractAboutPage {

  protected function aboutData() {
    return [
      'image' => 'images/cover.png',
      'sections' => [
        [
          'heading' => 'The original game (1983)',
          'html' =>
            '<p>Lunar Jetman was released by Ultimate Play The Game in 1983 for the 48K ZX Spectrum, '.
            'the sequel to their first game, Jetpac. Where Jetpac was one static screen on a 16K machine, '.
            'Lunar Jetman is a moon landscape that scrolls sideways, with a lunar rover that Jetman tows '.
            'behind him, craters to bridge, teleports, and an alien base that launches a missile at the '.
            'rover. The game tells you so itself, in as many words: <em>&ldquo;A missile has been launched '.
            'from the enemy base. Your lunar rover is in danger of being destroyed.&rdquo;</em> Losing the '.
            'rover is what ends the game.</p>'.
            '<p>It has a menu with one or two players and a choice of keyboard, Kempston or Cursor joystick, '.
            'a hall of fame of its own, and a reputation for being very hard indeed.</p>',
        ],
        [
          'heading' => 'This remake',
          'html' =>
            '<p>This is a faithful remake, rewritten for the web browser rather than emulated. The graphics '.
            'and the rules are taken out of the original program, not redrawn and not copied from a wiki — '.
            'where a rule cannot be shown, it is left as an open question rather than guessed. The character '.
            'set you see is the game\'s own, lifted out of its memory, because unlike most Spectrum games '.
            'Lunar Jetman does not print with the ROM font. Even the frame rate is the Spectrum\'s own '.
            '50.08 Hz, and the attribute clash of the hardware is reproduced instead of cleaned up.</p>'.
            '<p>It runs directly in your browser — nothing to install, nothing to download. Keyboard, '.
            'touch controls and gamepads are supported.</p>'.$this->installNote(),
        ],
        [
          'heading' => 'Other games',
          'html' =>
            '<p>This remake is one of a growing collection of classic games from the 8-bit and 16-bit era '.
            '— ZX Spectrum, Commodore 64, arcade and more — rebuilt faithfully on the same library and '.
            'playable in your browser, free of charge. Browse the whole collection at '.
            '<a href="https://retrogames.free/" target="_blank" rel="noopener">retrogames.free</a>.</p>',
        ],
      ],
      'links' => [
        ['label' => 'Lunar Jetman at Spectrum Computing', 'url' => 'https://spectrumcomputing.co.uk/'],
        ['label' => 'Lunar Jetman at World of Spectrum', 'url' => 'https://worldofspectrum.org/'],
      ],
      'footer' =>
        '<p>An unofficial fan remake. The original game and its artwork belong to their authors '.
        '(Ultimate Play The Game, today Rare/Microsoft). '.
        'The remake\'s source code is licensed under <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener">CC BY-NC-SA 4.0</a>.</p>',
    ];
  } // aboutData

} // AboutPage

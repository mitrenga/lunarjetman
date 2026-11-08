<?php
  $appName = 'LUNAR JETMAN';
  $appDescription = 'Play LUNAR JETMAN online for free in your browser. Faithful remake of the 1983 Ultimate Play The Game ZX Spectrum classic, no download required.';
  $appPrefix = 'ljm';
  $appNoscript =
    '<h1>LUNAR JETMAN</h1>'.
    '<p>Lunar Jetman is the 1983 ZX Spectrum game by Ultimate Play The Game, the sequel to Jetpac, '.
    'written for the 48K machine. Jetman is on the moon with a lunar rover in tow, and an alien base '.
    'has launched a missile at it. He has a jetpack, a laser, bombs, bridges for the craters and '.
    'not much time.</p>'.
    '<p>This is a faithful remake that runs directly in your web browser. '.
    'There is nothing to install and nothing to download — just open the page and play. '.
    'Please enable JavaScript to start the game.</p>'.
    '<p><a href="about">More about Lunar Jetman and this remake</a></p>';
  $appOpenGraph = [
    'image' => 'images/poster.png',
  ];
  $appJsonLd = [
    'genre' => 'Shooter',
    'isBasedOn' => [
      '@type' => 'VideoGame',
      'name' => 'Lunar Jetman',
      'publisher' => [
        ['@type' => 'Organization', 'name' => 'Ultimate Play The Game'],
      ],
      'datePublished' => '1983',
      'gamePlatform' => 'ZX Spectrum',
    ],
  ];
  require_once 'config/config.php';
  require_once 'app/svision/php/main.php';

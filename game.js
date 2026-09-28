const canvas = document.querySelector('#game-canvas');
const context = canvas.getContext('2d');
const titleScreen = document.querySelector('#title-screen');
const gameoverScreen = document.querySelector('#gameover-screen');
const scoreDisplay = document.querySelector('#score');
const distanceDisplay = document.querySelector('#distance');
const coinsDisplay = document.querySelector('#coins');
const bestDisplay = document.querySelector('#best');
const soundButton = document.querySelector('#sound-toggle');
const gameoverMessage = document.querySelector('#gameover-message');
const failureComment = document.querySelector('#failure-comment');
const missedCharacterPanel = document.querySelector('#missed-character');
const missedCharacterName = document.querySelector('#missed-character-name');
const portraitCanvas = document.querySelector('#missed-face');
const portraitContext = portraitCanvas.getContext('2d');
const checkpointCharacters = [
  { id: 'masayo', worldX: 15000, name: '昌代さん', hairstyle: 'long', color: '#d96f7f', failure: '昌代さんは捕まえないとだめだよ' },
  { id: 'akane', worldX: 20000, name: 'あかねちゃん', hairstyle: 'long', bangs: 'swept', color: '#e78a68', failure: 'あかねちゃんを無視するな！' },
  { id: 'yukina', worldX: 25000, name: 'ゆきなちゃん', hairstyle: 'bob', color: '#8ab6dc', failure: 'ゆきなちゃんを無視するな！' },
  { id: 'ririka', worldX: 30000, name: 'りりかちゃん', hairstyle: 'tied', color: '#9c9ad1', failure: 'りりかちゃんを無視するな！' },
];

const game = {
  state: 'title',
  width: 0,
  height: 0,
  groundY: 0,
  distance: 0,
  speed: 350,
  score: 0,
  coins: 0,
  best: loadBestScore(),
  soundOn: false,
  audioContext: null,
  lastTime: 0,
  elapsed: 0,
  wheelRotation: 0,
  worldEnd: 0,
  lastWasGap: false,
  segments: [],
  hazards: [],
  coinsInWorld: [],
  particles: [],
  characters: checkpointCharacters.map((character) => ({ ...character, caught: false })),
  vehicle: 'bike',
  speechBubble: null,
  player: {
    x: 135,
    y: 0,
    velocityY: 0,
    onGround: true,
    jumpsRemaining: 2,
    coyoteTime: 0,
    jumpBufferTime: 0,
  },
};

function loadBestScore() {
  try {
    return Number(localStorage.getItem('pedal-pop-best')) || 0;
  } catch {
    return 0;
  }
}

function saveBestScore(score) {
  try {
    localStorage.setItem('pedal-pop-best', String(score));
  } catch {
    // The game remains playable when browser storage is unavailable.
  }
}

function resizeCanvas() {
  const bounds = canvas.getBoundingClientRect();
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(bounds.width * pixelRatio);
  canvas.height = Math.round(bounds.height * pixelRatio);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  game.width = bounds.width;
  game.height = bounds.height;
  game.groundY = game.height * 0.77;
  game.player.x = Math.min(140, game.width * 0.27);
  if (game.player.onGround) game.player.y = game.groundY - 14;
  draw();
}

function terrainHeight(segment, worldX) {
  const progress = Math.max(0, Math.min(1, (worldX - segment.start) / segment.width));
  if (segment.kind === 'bump') return -Math.sin(progress * Math.PI) * 34;
  if (segment.kind === 'ramp') return -Math.sin(progress * Math.PI) * 48;
  if (segment.kind === 'step') {
    if (progress < 0.14 || progress > 0.86) return 0;
    const rise = Math.min(1, (progress - 0.14) / 0.08, (0.86 - progress) / 0.08);
    return -Math.max(0, rise) * 27;
  }
  return 0;
}

function segmentAt(worldX) {
  return game.segments.find((segment) => worldX >= segment.start && worldX < segment.end) || null;
}

function surfaceYAt(worldX) {
  const segment = segmentAt(worldX);
  if (!segment || segment.kind === 'gap') return null;
  return game.groundY + terrainHeight(segment, worldX);
}

function addSegment(kind, width) {
  const overlapsCharacter = checkpointCharacters.some((character) => (
    game.worldEnd <= character.worldX + 120
      && game.worldEnd + width >= character.worldX - 120
  ));
  const segmentKind = overlapsCharacter ? 'flat' : kind;
  const segment = {
    start: game.worldEnd,
    end: game.worldEnd + width,
    width,
    kind: segmentKind,
    launchAt: segmentKind === 'ramp' ? game.worldEnd + width * 0.68 : null,
  };
  game.segments.push(segment);
  game.worldEnd = segment.end;
  addSegmentItems(segment);
  game.lastWasGap = segmentKind === 'gap';
}

function addSegmentItems(segment) {
  if (segment.kind === 'gap') return;
  const difficulty = Math.min(game.distance / 18000, 1);

    if (segment.kind !== 'ramp' && segment.kind !== 'bump' && segment.kind !== 'step'
      && Math.random() < 0.32 + difficulty * 0.3) {
    const hazardX = segment.start + 185 + Math.random() * 45;
    const nearCharacter = checkpointCharacters.some((character) => (
      Math.abs(hazardX - character.worldX) <= 140
    ));
    if (!nearCharacter) {
      game.hazards.push({
        x: hazardX,
        type: Math.random() < 0.58 ? 'crate' : 'cone',
        width: 34,
        height: 36,
      });
    }
  }

  if (Math.random() < 0.45) {
    const count = 3 + Math.floor(Math.random() * 2);
    const lineStart = segment.start + 80 + Math.random() * 45;
    for (let index = 0; index < count; index += 1) {
      const arc = Math.sin((index / (count - 1)) * Math.PI);
      game.coinsInWorld.push({
        x: lineStart + index * 31,
        height: 112 + arc * (segment.kind === 'ramp' ? 52 : 38),
        phase: Math.random() * Math.PI * 2,
        collected: false,
      });
    }
  }
}

function generateWorld() {
  while (game.worldEnd < game.distance + game.width + 850) {
    const difficulty = Math.min(game.distance / 16000, 1);
    const roll = Math.random();
    if (!game.lastWasGap && roll < 0.09 + difficulty * 0.08) {
      addSegment('gap', 125 + Math.random() * 55);
    } else if (roll < 0.12 + difficulty * 0.1) {
      addSegment('ramp', 330 + Math.random() * 90);
    } else if (roll < 0.2 + difficulty * 0.12) {
      addSegment('bump', 320 + Math.random() * 100);
    } else if (roll < 0.27 + difficulty * 0.13) {
      addSegment('step', 320 + Math.random() * 90);
    } else {
      addSegment('flat', 340 + Math.random() * 130);
    }
  }
}

function resetGame() {
  game.distance = 0;
  game.speed = 350;
  game.score = 0;
  game.coins = 0;
  game.elapsed = 0;
  game.wheelRotation = 0;
  game.worldEnd = 0;
  game.lastWasGap = false;
  game.segments = [];
  game.hazards = [];
  game.coinsInWorld = [];
  game.particles = [];
  game.characters = checkpointCharacters.map((character) => ({ ...character, caught: false }));
  game.vehicle = 'bike';
  game.speechBubble = null;
  game.player.velocityY = 0;
  game.player.onGround = true;
  game.player.jumpsRemaining = 2;
  game.player.coyoteTime = 0;
  game.player.jumpBufferTime = 0;
  game.player.y = game.groundY - 14;
  addSegment('flat', 720);
  generateWorld();
  updateHud();
}

function startGame() {
  resetGame();
  game.state = 'running';
  document.body.dataset.state = game.state;
  titleScreen.hidden = true;
  gameoverScreen.hidden = true;
  game.lastTime = performance.now();
  playSound('start');
}

function performJump() {
  const player = game.player;
  const canUseGroundJump = player.onGround || player.coyoteTime > 0;
  const isSecondJump = !canUseGroundJump;
  if (isSecondJump && player.jumpsRemaining < 1) return false;

  player.jumpBufferTime = 0;
  player.coyoteTime = 0;
  player.jumpsRemaining -= 1;
  player.onGround = false;
  player.velocityY = isSecondJump ? -520 : -565;
  spawnParticles(player.x - 12, player.y + 4, isSecondJump ? '#f36f58' : '#fffdf5', 8);
  playSound('jump');
  return true;
}

function jump() {
  if (game.state !== 'running') return;
  game.player.jumpBufferTime = 0.18;
  if (game.player.onGround || game.player.coyoteTime > 0 || game.player.jumpsRemaining > 0) {
    performJump();
  }
}

function endGame(message = '', missedCharacter = null) {
  if (game.state !== 'running') return;
  updateHud();
  game.state = 'gameover';
  document.body.dataset.state = game.state;
  if (game.score > game.best) {
    game.best = game.score;
    saveBestScore(game.best);
  }
  document.querySelector('#final-score').textContent = game.score.toLocaleString();
  document.querySelector('#final-distance').textContent = `${Math.floor(game.distance / 10)} m`;
  document.querySelector('#final-coins').textContent = game.coins;
  document.querySelector('#final-best').textContent = game.best.toLocaleString();
  bestDisplay.textContent = game.best.toLocaleString();
  gameoverMessage.textContent = message;
  gameoverMessage.hidden = !message;
  failureComment.textContent = missedCharacter ? '' : getFailureComment(Math.floor(game.distance / 10));
  failureComment.hidden = !failureComment.textContent;
  missedCharacterPanel.hidden = !missedCharacter;
  if (missedCharacter) {
    missedCharacterName.textContent = missedCharacter.name;
    drawCharacterPortrait(missedCharacter);
  }
  gameoverScreen.hidden = false;
  playSound('crash');
  window.setTimeout(() => playSound('over'), 170);
}

function getFailureComment(distanceMeters) {
  const earlyFailureComments = [
    'へたくそ！！！！！',
    '初めてここで失敗する人見た',
    '英樹走向いてないよ(´；ω；`)',
    '挑戦一回目なの？',
    '足動かせよ！！！！',
  ];
  if (distanceMeters <= 700) {
    return earlyFailureComments[Math.floor(Math.random() * earlyFailureComments.length)];
  }
  if (distanceMeters < 1500) {
    const comments = [
      'ちょっと良くなったけど、まだまだだよ',
      'まって、今何につまずいたの？',
      'さっきよりは進んだけど満足するなよ！',
      '1500メートルは越そうよ～',
    ];
    return comments[Math.floor(Math.random() * comments.length)];
  }
  if (distanceMeters < 2000) return '子供たち生まれてないのに(´;ω;｀)';
  if (distanceMeters < 2500) return 'あと二人いるんじゃない？？';
  if (distanceMeters < 3000) return 'あとりりか！';
  return '太田家集合したね！！！！！すごい！\nここまで走れたのは才能だよ。\nもうこのゲームはやめていいよ！';
}

function updateHud() {
  game.score = Math.floor(game.distance / 10) + game.coins * 50;
  distanceDisplay.textContent = `${Math.floor(game.distance / 10)} m`;
  scoreDisplay.textContent = game.score.toLocaleString();
  coinsDisplay.textContent = String(game.coins);
  bestDisplay.textContent = game.best.toLocaleString();
}

function toggleSound() {
  game.soundOn = !game.soundOn;
  soundButton.textContent = game.soundOn ? '♫' : '♪';
  soundButton.setAttribute('aria-label', game.soundOn ? 'サウンドをオフにする' : 'サウンドをオンにする');
  soundButton.setAttribute('aria-pressed', String(game.soundOn));
  if (game.soundOn && game.audioContext?.state === 'suspended') game.audioContext.resume();
  if (game.soundOn) playSound('coin');
}

function playSound(type) {
  if (!game.soundOn) return;
  const sounds = {
    start: [440, 620],
    jump: [390],
    coin: [760, 990],
    crash: [190, 115],
    over: [330, 245, 165],
  };
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!game.audioContext) game.audioContext = new AudioContext();
    if (game.audioContext.state === 'suspended') game.audioContext.resume();
    const audio = game.audioContext;
    sounds[type].forEach((frequency, index) => {
      const oscillator = audio.createOscillator();
      const volume = audio.createGain();
      const startAt = audio.currentTime + index * 0.075;
      oscillator.type = type === 'crash' ? 'sawtooth' : 'triangle';
      oscillator.frequency.setValueAtTime(frequency, startAt);
      volume.gain.setValueAtTime(0.0001, startAt);
      volume.gain.exponentialRampToValueAtTime(0.12, startAt + 0.012);
      volume.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.13);
      oscillator.connect(volume);
      volume.connect(audio.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + 0.14);
    });
  } catch {
    // Audio support is optional; visual gameplay does not depend on it.
  }
}

function spawnParticles(x, y, color, count) {
  for (let index = 0; index < count; index += 1) {
    const angle = (Math.PI * 2 * index) / count + Math.random() * 0.4;
    const force = 35 + Math.random() * 100;
    game.particles.push({
      x,
      y,
      velocityX: Math.cos(angle) * force,
      velocityY: Math.sin(angle) * force - 25,
      color,
      life: 0.55 + Math.random() * 0.25,
      age: 0,
      size: 2 + Math.random() * 3,
    });
  }
}

function drawCloud(x, y, scale) {
  context.fillStyle = 'rgba(255, 253, 245, 0.86)';
  context.beginPath();
  context.ellipse(x, y, 31 * scale, 13 * scale, 0, 0, Math.PI * 2);
  context.ellipse(x - 17 * scale, y + 2 * scale, 17 * scale, 11 * scale, 0, 0, Math.PI * 2);
  context.ellipse(x + 15 * scale, y + 1 * scale, 19 * scale, 12 * scale, 0, 0, Math.PI * 2);
  context.fill();
}

function drawTennisCourt(screenX) {
  const groundY = game.groundY;
  context.fillStyle = 'rgba(31, 73, 67, 0.55)';
  context.beginPath();
  context.moveTo(screenX + 24, groundY - 151);
  context.lineTo(screenX + 247, groundY - 151);
  context.lineTo(screenX + 259, groundY - 112);
  context.lineTo(screenX + 11, groundY - 112);
  context.closePath();
  context.fill();

  context.strokeStyle = 'rgba(238, 247, 218, 0.38)';
  context.lineWidth = 1;
  for (let index = 0; index <= 12; index += 1) {
    const topX = screenX + 24 + index * 18.5;
    const bottomX = screenX + 11 + index * 20.7;
    context.beginPath();
    context.moveTo(topX, groundY - 151);
    context.lineTo(bottomX, groundY - 112);
    context.stroke();
  }
  context.beginPath();
  context.moveTo(screenX + 24, groundY - 138);
  context.lineTo(screenX + 251, groundY - 138);
  context.moveTo(screenX + 19, groundY - 124);
  context.lineTo(screenX + 255, groundY - 124);
  context.stroke();

  context.fillStyle = '#387d5c';
  context.beginPath();
  context.moveTo(screenX + 31, groundY - 108);
  context.lineTo(screenX + 235, groundY - 108);
  context.lineTo(screenX + 258, groundY - 7);
  context.lineTo(screenX + 3, groundY - 7);
  context.closePath();
  context.fill();
  context.fillStyle = '#5bad72';
  context.beginPath();
  context.moveTo(screenX + 49, groundY - 98);
  context.lineTo(screenX + 217, groundY - 98);
  context.lineTo(screenX + 235, groundY - 17);
  context.lineTo(screenX + 24, groundY - 17);
  context.closePath();
  context.fill();

  context.strokeStyle = '#f4f6dc';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(screenX + 49, groundY - 98);
  context.lineTo(screenX + 217, groundY - 98);
  context.lineTo(screenX + 235, groundY - 17);
  context.lineTo(screenX + 24, groundY - 17);
  context.closePath();
  context.moveTo(screenX + 133, groundY - 98);
  context.lineTo(screenX + 130, groundY - 17);
  context.moveTo(screenX + 39, groundY - 57);
  context.lineTo(screenX + 226, groundY - 57);
  context.stroke();

  context.strokeStyle = '#e9edda';
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(screenX + 28, groundY - 59);
  context.lineTo(screenX + 232, groundY - 59);
  context.stroke();
  context.strokeStyle = 'rgba(42, 59, 48, 0.72)';
  context.lineWidth = 1;
  for (let index = 0; index <= 12; index += 1) {
    const netX = screenX + 28 + index * 17;
    context.beginPath();
    context.moveTo(netX, groundY - 59);
    context.lineTo(netX, groundY - 48);
    context.stroke();
  }
  context.strokeStyle = '#ecebd1';
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(screenX + 28, groundY - 64);
  context.lineTo(screenX + 28, groundY - 52);
  context.moveTo(screenX + 232, groundY - 64);
  context.lineTo(screenX + 232, groundY - 52);
  context.stroke();
}

function drawBackground() {
  const sky = context.createLinearGradient(0, 0, 0, game.height);
  sky.addColorStop(0, '#9fdfee');
  sky.addColorStop(0.68, '#d8f0d8');
  sky.addColorStop(1, '#f8edc2');
  context.fillStyle = sky;
  context.fillRect(0, 0, game.width, game.height);

  context.fillStyle = '#fff7cf';
  context.beginPath();
  context.arc(game.width * 0.78, game.height * 0.2, 30, 0, Math.PI * 2);
  context.fill();

  const cloudDrift = game.elapsed * 8;
  for (let index = 0; index < 4; index += 1) {
    const x = ((index * 255 - cloudDrift) % (game.width + 180) + game.width + 180) % (game.width + 180) - 70;
    drawCloud(x, game.height * (0.14 + (index % 2) * 0.12), 0.7 + (index % 3) * 0.15);
  }

  const mountainOffset = (game.distance * 0.11) % 220;
  for (let x = -mountainOffset - 220; x < game.width + 220; x += 220) {
    context.fillStyle = '#91cfae';
    context.beginPath();
    context.moveTo(x, game.groundY + 2);
    context.lineTo(x + 105, game.groundY - 115);
    context.lineTo(x + 213, game.groundY + 2);
    context.closePath();
    context.fill();
    context.fillStyle = '#b5db9b';
    context.beginPath();
    context.moveTo(x + 100, game.groundY + 2);
    context.lineTo(x + 173, game.groundY - 85);
    context.lineTo(x + 248, game.groundY + 2);
    context.closePath();
    context.fill();
  }

  const courtOffset = (game.distance * 0.24) % 900;
  for (let x = -courtOffset - 60; x < game.width + 300; x += 900) {
    drawTennisCourt(x);
  }

  context.fillStyle = '#6eaf78';
  context.fillRect(0, game.groundY, game.width, game.height - game.groundY);
}

function drawTerrain() {
  for (const segment of game.segments) {
    const screenStart = game.player.x + segment.start - game.distance;
    const screenEnd = game.player.x + segment.end - game.distance;
    if (screenEnd < -5 || screenStart > game.width + 5) continue;

    if (segment.kind === 'gap') {
      context.fillStyle = '#315d54';
      context.beginPath();
      context.moveTo(screenStart, game.groundY + 2);
      context.lineTo(screenStart + 15, game.groundY + 52);
      context.lineTo(screenEnd - 15, game.groundY + 52);
      context.lineTo(screenEnd, game.groundY + 2);
      context.closePath();
      context.fill();
      context.fillStyle = '#f36f58';
      context.fillRect(screenStart, game.groundY - 3, 5, 6);
      context.fillRect(screenEnd - 5, game.groundY - 3, 5, 6);
      continue;
    }

    context.beginPath();
    context.moveTo(screenStart, game.groundY + terrainHeight(segment, segment.start));
    const sampleCount = Math.max(2, Math.ceil(segment.width / 22));
    for (let index = 1; index <= sampleCount; index += 1) {
      const worldX = segment.start + (segment.width * index) / sampleCount;
      context.lineTo(game.player.x + worldX - game.distance, game.groundY + terrainHeight(segment, worldX));
    }
    context.lineTo(screenEnd, game.height);
    context.lineTo(screenStart, game.height);
    context.closePath();
    context.fillStyle = segment.kind === 'step' ? '#54ad76' : '#64bd80';
    context.fill();

    context.beginPath();
    for (let index = 0; index <= sampleCount; index += 1) {
      const worldX = segment.start + (segment.width * index) / sampleCount;
      const screenX = game.player.x + worldX - game.distance;
      const surfaceY = game.groundY + terrainHeight(segment, worldX);
      if (index === 0) context.moveTo(screenX, surfaceY);
      else context.lineTo(screenX, surfaceY);
    }
    context.strokeStyle = '#33875d';
    context.lineWidth = 7;
    context.lineCap = 'round';
    context.stroke();
  }
}

function drawTree(worldX) {
  const screenX = game.player.x + worldX - game.distance;
  const groundY = surfaceYAt(worldX);
  if (groundY === null || screenX < -40 || screenX > game.width + 40) return;
  context.fillStyle = '#95694d';
  context.fillRect(screenX - 4, groundY - 36, 9, 37);
  context.fillStyle = '#318a66';
  context.beginPath();
  context.arc(screenX, groundY - 47, 19, 0, Math.PI * 2);
  context.arc(screenX - 12, groundY - 38, 13, 0, Math.PI * 2);
  context.arc(screenX + 12, groundY - 38, 13, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#72c17d';
  context.beginPath();
  context.arc(screenX - 5, groundY - 53, 6, 0, Math.PI * 2);
  context.fill();
}

function drawTrees() {
  const firstTree = Math.max(0, Math.floor((game.distance - game.player.x) / 310));
  const lastTree = Math.ceil((game.distance + game.width) / 310);
  for (let index = firstTree; index <= lastTree; index += 1) drawTree(120 + index * 310);
}

function drawCheckpointCharacter(character) {
  if (character.caught) return;
  const screenX = game.player.x + character.worldX - game.distance;
  if (screenX < -100 || screenX > game.width + 100) return;
  const floorY = surfaceYAt(character.worldX);
  if (floorY === null) return;
  const headY = floorY - 78;

  context.fillStyle = 'rgba(34, 53, 43, 0.22)';
  context.beginPath();
  context.ellipse(screenX, floorY - 2, 17, 4, 0, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = '#372735';
  context.beginPath();
  context.moveTo(screenX - 12, headY - 4);
  context.quadraticCurveTo(screenX - 18, headY - 21, screenX, headY - 21);
  context.quadraticCurveTo(screenX + 17, headY - 19, screenX + 13, headY + 2);
  if (character.hairstyle === 'long') {
    context.lineTo(screenX + 17, floorY - 19);
    context.quadraticCurveTo(screenX + 8, floorY - 12, screenX + 5, floorY - 29);
    context.lineTo(screenX + 1, headY + 17);
    context.lineTo(screenX - 6, floorY - 24);
    context.quadraticCurveTo(screenX - 13, floorY - 18, screenX - 16, floorY - 27);
  } else {
    const hairBottom = character.hairstyle === 'bob' ? headY + 18 : headY + 9;
    context.lineTo(screenX + 14, hairBottom);
    context.quadraticCurveTo(screenX + 7, hairBottom + 5, screenX + 2, hairBottom - 1);
    context.lineTo(screenX - 5, hairBottom + 2);
    context.quadraticCurveTo(screenX - 13, hairBottom + 4, screenX - 15, headY + 5);
    if (character.hairstyle === 'tied') {
      context.moveTo(screenX + 9, headY - 11);
      context.quadraticCurveTo(screenX + 27, headY - 15, screenX + 23, headY + 9);
      context.quadraticCurveTo(screenX + 17, headY + 19, screenX + 13, headY + 8);
    }
  }
  context.closePath();
  context.fill();

  context.fillStyle = character.color;
  context.beginPath();
  context.moveTo(screenX - 10, floorY - 54);
  context.lineTo(screenX + 9, floorY - 54);
  context.lineTo(screenX + 14, floorY - 14);
  context.lineTo(screenX - 14, floorY - 14);
  context.closePath();
  context.fill();

  context.strokeStyle = '#e7b995';
  context.lineWidth = 5;
  context.lineCap = 'round';
  context.beginPath();
  context.moveTo(screenX - 9, floorY - 50);
  context.lineTo(screenX - 18, floorY - 31);
  context.moveTo(screenX + 8, floorY - 50);
  context.lineTo(screenX + 17, floorY - 34);
  context.stroke();

  context.strokeStyle = '#f1d1b5';
  context.lineWidth = 5;
  context.beginPath();
  context.moveTo(screenX - 6, floorY - 14);
  context.lineTo(screenX - 8, floorY - 3);
  context.moveTo(screenX + 6, floorY - 14);
  context.lineTo(screenX + 8, floorY - 3);
  context.stroke();

  context.fillStyle = '#f0c9a7';
  context.beginPath();
  context.arc(screenX, headY, 12, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#372735';
  context.beginPath();
  context.arc(screenX - 1, headY - 8, 13, Math.PI, Math.PI * 2);
  context.lineTo(screenX + 12, headY + 9);
  context.quadraticCurveTo(screenX + 5, headY + 5, screenX + 5, headY - 3);
  context.lineTo(screenX - 8, headY - 3);
  context.quadraticCurveTo(screenX - 7, headY + 8, screenX - 12, headY + 12);
  context.closePath();
  context.fill();

  if (character.bangs === 'swept') {
    context.fillStyle = '#372735';
    context.beginPath();
    context.moveTo(screenX - 13, headY - 8);
    context.quadraticCurveTo(screenX - 13, headY - 25, screenX + 1, headY - 23);
    context.quadraticCurveTo(screenX + 13, headY - 22, screenX + 12, headY - 11);
    context.quadraticCurveTo(screenX + 5, headY - 14, screenX + 1, headY - 8);
    context.quadraticCurveTo(screenX - 5, headY - 2, screenX - 13, headY + 1);
    context.quadraticCurveTo(screenX - 8, headY - 5, screenX - 13, headY - 8);
    context.closePath();
    context.fill();
  }

  context.fillStyle = '#392e30';
  context.beginPath();
  context.arc(screenX + 3, headY, 1.2, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = '#754d48';
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(screenX + 1, headY + 5);
  context.quadraticCurveTo(screenX + 4, headY + 7, screenX + 7, headY + 5);
  context.stroke();

  context.fillStyle = '#fffdf5';
  context.strokeStyle = '#17333a';
  context.lineWidth = 1.5;
  context.beginPath();
  context.roundRect(screenX - 31, headY - 48, 62, 21, 6);
  context.fill();
  context.stroke();
  context.fillStyle = '#17333a';
  context.font = 'bold 11px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(character.name, screenX, headY - 37);
}

function drawCharacterPortrait(character) {
  const { width, height } = portraitCanvas;
  portraitContext.clearRect(0, 0, width, height);
  portraitContext.fillStyle = '#f4dfc9';
  portraitContext.beginPath();
  portraitContext.arc(width / 2, height / 2, 54, 0, Math.PI * 2);
  portraitContext.fill();

  const centerX = width / 2;
  const faceY = 57;
  portraitContext.fillStyle = '#372735';
  portraitContext.beginPath();
  portraitContext.arc(centerX, 48, 30, Math.PI, Math.PI * 2);
  if (character.hairstyle === 'long') {
    portraitContext.lineTo(centerX + 27, 96);
    portraitContext.lineTo(centerX + 18, 87);
    portraitContext.lineTo(centerX + 10, 99);
    portraitContext.lineTo(centerX - 13, 91);
    portraitContext.lineTo(centerX - 27, 99);
  } else {
    const bottom = character.hairstyle === 'bob' ? 82 : 70;
    portraitContext.lineTo(centerX + 28, bottom);
    portraitContext.quadraticCurveTo(centerX, bottom + 9, centerX - 28, bottom);
    if (character.hairstyle === 'tied') {
      portraitContext.moveTo(centerX + 21, 39);
      portraitContext.quadraticCurveTo(centerX + 42, 36, centerX + 38, 68);
      portraitContext.lineTo(centerX + 25, 63);
    }
  }
  portraitContext.closePath();
  portraitContext.fill();

  portraitContext.fillStyle = '#f0c9a7';
  portraitContext.beginPath();
  portraitContext.ellipse(centerX, faceY, 23, 28, 0, 0, Math.PI * 2);
  portraitContext.fill();
  portraitContext.fillStyle = '#372735';
  if (character.bangs === 'swept') {
    portraitContext.beginPath();
    portraitContext.moveTo(centerX - 24, 43);
    portraitContext.quadraticCurveTo(centerX - 27, 20, centerX - 7, 20);
    portraitContext.quadraticCurveTo(centerX + 17, 17, centerX + 25, 35);
    portraitContext.quadraticCurveTo(centerX + 27, 42, centerX + 18, 49);
    portraitContext.quadraticCurveTo(centerX + 12, 41, centerX + 6, 39);
    portraitContext.quadraticCurveTo(centerX - 2, 50, centerX - 16, 56);
    portraitContext.quadraticCurveTo(centerX - 11, 48, centerX - 15, 45);
    portraitContext.quadraticCurveTo(centerX - 21, 47, centerX - 24, 43);
    portraitContext.closePath();
    portraitContext.fill();
    portraitContext.strokeStyle = '#78616a';
    portraitContext.lineWidth = 1.5;
    portraitContext.beginPath();
    portraitContext.moveTo(centerX - 17, 39);
    portraitContext.quadraticCurveTo(centerX - 1, 27, centerX + 13, 30);
    portraitContext.stroke();
  } else {
    portraitContext.beginPath();
    portraitContext.arc(centerX, 42, 25, Math.PI, Math.PI * 2);
    portraitContext.lineTo(centerX + 22, 59);
    portraitContext.quadraticCurveTo(centerX + 5, 49, centerX + 3, 53);
    portraitContext.lineTo(centerX - 10, 53);
    portraitContext.quadraticCurveTo(centerX - 19, 62, centerX - 23, 61);
    portraitContext.closePath();
    portraitContext.fill();
  }

  portraitContext.fillStyle = '#392e30';
  portraitContext.beginPath();
  portraitContext.arc(centerX - 8, faceY + 1, 2, 0, Math.PI * 2);
  portraitContext.arc(centerX + 8, faceY + 1, 2, 0, Math.PI * 2);
  portraitContext.fill();
  portraitContext.strokeStyle = '#754d48';
  portraitContext.lineWidth = 2;
  portraitContext.beginPath();
  portraitContext.arc(centerX, faceY + 10, 6, 0.2, Math.PI - 0.2);
  portraitContext.stroke();
}

function drawCoin(coin) {
  if (coin.collected) return;
  const screenX = game.player.x + coin.x - game.distance;
  if (screenX < -25 || screenX > game.width + 25) return;
  const segment = segmentAt(coin.x);
  if (!segment) return;
  const screenY = game.groundY + terrainHeight(segment, coin.x) - coin.height;
  context.save();
  context.translate(screenX, screenY);
  context.rotate(game.elapsed * 3.5 + coin.phase);
  context.fillStyle = '#c8ed61';
  context.beginPath();
  context.arc(0, 0, 11, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = '#477b35';
  context.lineWidth = 1.5;
  context.stroke();
  context.strokeStyle = '#f5ffc6';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(-7, -7);
  context.quadraticCurveTo(1, 0, -7, 7);
  context.moveTo(7, -7);
  context.quadraticCurveTo(-1, 0, 7, 7);
  context.stroke();
  context.fillStyle = 'rgba(255, 255, 225, 0.7)';
  context.beginPath();
  context.arc(-4, -5, 2, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawHazard(hazard) {
  const screenX = game.player.x + hazard.x - game.distance;
  if (screenX < -50 || screenX > game.width + 50) return;
  const groundY = surfaceYAt(hazard.x);
  if (groundY === null) return;
  if (hazard.type === 'crate') {
    context.fillStyle = '#cf704c';
    context.fillRect(screenX - 16, groundY - 35, 32, 35);
    context.strokeStyle = '#814d3a';
    context.lineWidth = 3;
    context.strokeRect(screenX - 16, groundY - 35, 32, 35);
    context.beginPath();
    context.moveTo(screenX - 13, groundY - 32);
    context.lineTo(screenX + 13, groundY - 4);
    context.moveTo(screenX + 13, groundY - 32);
    context.lineTo(screenX - 13, groundY - 4);
    context.stroke();
  } else {
    context.fillStyle = '#f36f58';
    context.beginPath();
    context.moveTo(screenX, groundY - 37);
    context.lineTo(screenX + 17, groundY);
    context.lineTo(screenX - 17, groundY);
    context.closePath();
    context.fill();
    context.fillStyle = '#fff1d0';
    context.fillRect(screenX - 9, groundY - 14, 18, 5);
  }
}

function drawCar(x, wheelY) {
  context.save();
  context.translate(x, wheelY);
  context.scale(2 / 3, 2 / 3);
  context.translate(-x, -wheelY);

  context.fillStyle = 'rgba(34, 53, 43, 0.24)';
  context.beginPath();
  context.ellipse(x + 3, wheelY - 2, 101, 8, 0, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = '#ffc85c';
  context.strokeStyle = '#17333a';
  context.lineWidth = 3;
  context.beginPath();
  context.roundRect(x - 96, wheelY - 34, 190, 29, 9);
  context.fill();
  context.stroke();

  context.fillStyle = '#f1aa4d';
  context.beginPath();
  context.moveTo(x - 68, wheelY - 32);
  context.lineTo(x - 50, wheelY - 58);
  context.quadraticCurveTo(x - 47, wheelY - 62, x - 39, wheelY - 62);
  context.lineTo(x + 48, wheelY - 62);
  context.quadraticCurveTo(x + 56, wheelY - 61, x + 62, wheelY - 32);
  context.closePath();
  context.fill();
  context.stroke();

  context.fillStyle = '#a6e4e8';
  context.strokeStyle = '#17333a';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(x - 45, wheelY - 57);
  context.lineTo(x - 8, wheelY - 57);
  context.lineTo(x - 8, wheelY - 36);
  context.lineTo(x - 62, wheelY - 36);
  context.closePath();
  context.fill();
  context.stroke();
  context.beginPath();
  context.moveTo(x - 3, wheelY - 57);
  context.lineTo(x + 43, wheelY - 57);
  context.lineTo(x + 53, wheelY - 36);
  context.lineTo(x - 3, wheelY - 36);
  context.closePath();
  context.fill();
  context.stroke();

  for (const wheelX of [x - 61, x + 55]) {
    context.fillStyle = '#26383b';
    context.beginPath();
    context.arc(wheelX, wheelY - 7, 13, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#d9ece2';
    context.beginPath();
    context.arc(wheelX, wheelY - 7, 5, 0, Math.PI * 2);
    context.fill();
  }

  context.fillStyle = '#fff5c8';
  context.fillRect(x + 82, wheelY - 27, 8, 5);
  context.fillStyle = '#f07c67';
  context.fillRect(x - 95, wheelY - 26, 5, 7);
  context.restore();
}

function drawSeatedPassenger(character, x, wheelY, scale = 1) {
  context.save();
  context.translate(x, wheelY);
  context.scale(scale, scale);
  context.translate(-x, -wheelY);

  context.fillStyle = character.color;
  context.beginPath();
  context.moveTo(x - 8, wheelY - 33);
  context.lineTo(x + 8, wheelY - 33);
  context.lineTo(x + 11, wheelY - 8);
  context.lineTo(x - 11, wheelY - 8);
  context.closePath();
  context.fill();

  context.fillStyle = '#f0c9a7';
  context.beginPath();
  context.arc(x, wheelY - 43, 8, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = '#372735';
  context.beginPath();
  context.arc(x, wheelY - 47, 8, Math.PI, Math.PI * 2);
  if (character.hairstyle === 'long') {
    context.lineTo(x + 9, wheelY - 17);
    context.lineTo(x + 3, wheelY - 22);
    context.lineTo(x - 5, wheelY - 16);
    context.lineTo(x - 9, wheelY - 26);
  } else {
    const bottom = character.hairstyle === 'bob' ? wheelY - 30 : wheelY - 37;
    context.lineTo(x + 8, bottom);
    context.quadraticCurveTo(x, bottom + 5, x - 8, bottom);
    if (character.hairstyle === 'tied') {
      context.moveTo(x + 5, wheelY - 48);
      context.lineTo(x + 13, wheelY - 43);
      context.lineTo(x + 10, wheelY - 34);
      context.lineTo(x + 4, wheelY - 39);
    }
  }
  context.closePath();
  context.fill();

  if (character.bangs === 'swept') {
    context.beginPath();
    context.moveTo(x - 8, wheelY - 46);
    context.quadraticCurveTo(x - 7, wheelY - 58, x + 2, wheelY - 56);
    context.quadraticCurveTo(x + 10, wheelY - 55, x + 9, wheelY - 48);
    context.quadraticCurveTo(x + 3, wheelY - 51, x, wheelY - 46);
    context.quadraticCurveTo(x - 3, wheelY - 42, x - 8, wheelY - 42);
    context.closePath();
    context.fill();
  }

  context.fillStyle = '#372735';
  context.beginPath();
  context.arc(x + 2, wheelY - 43, 1, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawSpeechBubble() {
  const bubble = game.speechBubble;
  if (!bubble || game.elapsed > bubble.expiresAt) return;
  context.font = 'bold 19px sans-serif';
  const bubbleWidth = Math.max(114, context.measureText(bubble.text).width + 26);
  const centerX = Math.max(bubbleWidth / 2 + 8, Math.min(game.width - bubbleWidth / 2 - 8, game.player.x + 42));
  const bubbleY = game.player.y - 124;

  context.fillStyle = '#fffdf5';
  context.strokeStyle = '#17333a';
  context.lineWidth = 2;
  context.beginPath();
  context.roundRect(centerX - bubbleWidth / 2, bubbleY - 22, bubbleWidth, 42, 12);
  context.fill();
  context.stroke();
  context.beginPath();
  context.moveTo(centerX - 7, bubbleY + 19);
  context.lineTo(centerX - 1, bubbleY + 28);
  context.lineTo(centerX + 7, bubbleY + 19);
  context.closePath();
  context.fill();
  context.stroke();

  context.fillStyle = '#df5671';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(bubble.text, centerX, bubbleY - 1);
}

function drawPlayer() {
  const { x, y } = game.player;
  const wheelRadius = 15;
  const rearWheelX = x - 21;
  const frontWheelX = x + 26;
  const wheelY = y;
  const airborne = !game.player.onGround;
  const lean = airborne ? Math.max(-0.22, Math.min(0.22, -game.player.velocityY / 6000)) : Math.sin(game.elapsed * 13) * 0.025;

  const usingCar = game.vehicle === 'car';
  const passengers = game.characters.filter((character) => character.caught);
  if (usingCar) {
    drawCar(x, wheelY);
  } else {
    const wife = passengers.find((character) => character.id === 'masayo');
    if (wife) drawSeatedPassenger(wife, x - 22, wheelY - 3, 0.82);

  context.lineWidth = 4;
  context.strokeStyle = '#17333a';
  context.lineCap = 'round';
  context.beginPath();
  context.moveTo(rearWheelX, wheelY);
  context.lineTo(x + 1, wheelY - 2);
  context.lineTo(frontWheelX, wheelY);
  context.lineTo(x - 8, wheelY - 28);
  context.lineTo(rearWheelX, wheelY);
  context.moveTo(x - 8, wheelY - 28);
  context.lineTo(x + 12, wheelY - 28);
  context.lineTo(frontWheelX, wheelY);
  context.stroke();

  context.strokeStyle = '#8b6349';
  context.lineWidth = 5;
  context.beginPath();
  context.moveTo(x - 15, wheelY - 30);
  context.lineTo(x - 5, wheelY - 30);
  context.moveTo(x + 9, wheelY - 28);
  context.lineTo(x + 17, wheelY - 34);
  context.stroke();

  for (const wheelX of [rearWheelX, frontWheelX]) {
    context.beginPath();
    context.arc(wheelX, wheelY, wheelRadius, 0, Math.PI * 2);
    context.stroke();
    context.save();
    context.translate(wheelX, wheelY);
    context.rotate(game.wheelRotation);
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(0, -wheelRadius + 4);
    context.lineTo(0, wheelRadius - 4);
    context.moveTo(-wheelRadius + 5, -wheelRadius + 5);
    context.lineTo(wheelRadius - 5, wheelRadius - 5);
    context.stroke();
    context.restore();
  }
  }

  const bodyOffset = airborne ? 3 : Math.sin(game.elapsed * 13) * 1.5;
  const headY = wheelY - 63 - bodyOffset;
  context.save();
  if (usingCar) context.translate(48, 0);
  context.translate(x - 1, wheelY - 37);
  context.rotate(lean);
  context.translate(-(x - 1), -(wheelY - 37));

  if (!usingCar) {
    context.strokeStyle = '#38474a';
    context.lineWidth = 7;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(x - 4, wheelY - 37);
    context.lineTo(x + 5, wheelY - 24);
    context.lineTo(x + 2, wheelY - 3);
    context.moveTo(x - 4, wheelY - 37);
    context.lineTo(x - 13, wheelY - 25);
    context.lineTo(x - 7, wheelY - 4);
    context.stroke();

    context.strokeStyle = '#f1c24f';
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(x - 7, wheelY - 4);
    context.lineTo(x - 1, wheelY - 4);
    context.moveTo(x + 2, wheelY - 3);
    context.lineTo(x + 8, wheelY - 3);
    context.stroke();
  }

  context.fillStyle = '#f36f58';
  context.strokeStyle = '#17333a';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(x - 12, wheelY - 53 - bodyOffset);
  context.lineTo(x - 1, wheelY - 57 - bodyOffset);
  context.lineTo(x + 10, wheelY - 40);
  context.lineTo(x + 3, wheelY - 34);
  context.lineTo(x - 11, wheelY - 43);
  context.closePath();
  context.fill();
  context.stroke();

  context.strokeStyle = '#a95f3b';
  context.lineWidth = 6;
  context.beginPath();
  context.moveTo(x - 9, wheelY - 50 - bodyOffset);
  context.lineTo(x - 1, wheelY - 41);
  context.lineTo(x + 11, wheelY - 33);
  context.moveTo(x + 2, wheelY - 51 - bodyOffset);
  context.lineTo(x + 14, wheelY - 45);
  context.lineTo(x + 18, wheelY - 49);
  context.stroke();

  context.fillStyle = '#a95f3b';
  context.beginPath();
  context.arc(x - 5, headY, 13, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#d28a5d';
  context.beginPath();
  context.arc(x - 18, headY + 1, 3, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#85847c';
  context.beginPath();
  context.moveTo(x - 18, headY - 3);
  context.quadraticCurveTo(x - 17, headY - 17, x - 5, headY - 16);
  context.quadraticCurveTo(x + 7, headY - 17, x + 8, headY - 5);
  context.lineTo(x + 4, headY - 9);
  context.lineTo(x - 14, headY - 8);
  context.closePath();
  context.fill();

  context.fillStyle = '#fff9dd';
  context.strokeStyle = '#17333a';
  context.lineWidth = 2.5;
  context.beginPath();
  context.arc(x - 10, headY - 1, 5.5, 0, Math.PI * 2);
  context.arc(x + 1, headY - 1, 5.5, 0, Math.PI * 2);
  context.moveTo(x - 4.5, headY - 1);
  context.lineTo(x - 4.5, headY - 1);
  context.stroke();
  context.fillStyle = '#17333a';
  context.beginPath();
  context.arc(x - 10, headY - 1, 1.4, 0, Math.PI * 2);
  context.arc(x + 1, headY - 1, 1.4, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = '#75422f';
  context.lineWidth = 3;
  context.lineCap = 'round';
  context.beginPath();
  context.moveTo(x - 9, headY + 6);
  context.quadraticCurveTo(x - 5, headY + 9, x - 2, headY + 6);
  context.moveTo(x - 2, headY + 6);
  context.quadraticCurveTo(x + 2, headY + 9, x + 5, headY + 5);
  context.stroke();

  context.fillStyle = '#75422f';
  context.beginPath();
  context.arc(x - 5, headY + 1, 1.5, 0, Math.PI * 2);
  context.fill();
  context.restore();

  if (usingCar) {
    passengers.forEach((character, index) => {
      drawSeatedPassenger(character, x - 51 + index * 23, wheelY - 23, 0.68);
    });
  }
}

function drawParticles() {
  for (const particle of game.particles) {
    const opacity = Math.max(0, 1 - particle.age / particle.life);
    context.globalAlpha = opacity;
    context.fillStyle = particle.color;
    context.beginPath();
    context.arc(particle.x, particle.y, particle.size * opacity, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;
}

function draw() {
  if (!game.width || !game.height) return;
  drawBackground();
  context.save();
  context.translate(game.player.x, game.groundY);
  context.scale(0.8, 0.8);
  context.translate(-game.player.x, -game.groundY);
  drawTerrain();
  drawTrees();
  for (const character of game.characters) drawCheckpointCharacter(character);
  for (const coin of game.coinsInWorld) drawCoin(coin);
  for (const hazard of game.hazards) drawHazard(hazard);
  drawPlayer();
  drawParticles();
  context.restore();
  drawSpeechBubble();
}

function checkCollisions() {
  const playerLeft = game.player.x - 24;
  const playerRight = game.player.x + 32;
  const playerTop = game.player.y - 73;
  const playerBottom = game.player.y + 5;

  for (const coin of game.coinsInWorld) {
    if (coin.collected) continue;
    const screenX = game.player.x + coin.x - game.distance;
    const segment = segmentAt(coin.x);
    if (!segment) continue;
    const screenY = game.groundY + terrainHeight(segment, coin.x) - coin.height;
    const closeX = Math.abs(screenX - game.player.x) < 28;
    const closeY = Math.abs(screenY - (game.player.y - 45)) < 48;
    if (closeX && closeY) {
      coin.collected = true;
      game.coins += 1;
      spawnParticles(screenX, screenY, '#ffb933', 10);
      playSound('coin');
    }
  }

  for (const character of game.characters) {
    if (character.caught) continue;
    const floorY = surfaceYAt(character.worldX);
    const nearEnough = Math.abs(game.distance - character.worldX) < 43;
    const atHerLevel = floorY !== null && Math.abs(game.player.y - (floorY - 14)) < 78;
    if (nearEnough && atHerLevel) {
      character.caught = true;
      spawnParticles(game.player.x, game.player.y - 48, '#f1a2ad', 20);
      playSound('coin');
      const celebration = {
        masayo: '昌代さんと結婚💗',
        akane: 'あかね誕生！',
        yukina: 'ゆきな誕生！',
        ririka: 'りりか誕生！',
      }[character.id];
      game.speechBubble = { text: celebration, expiresAt: game.elapsed + 3 };
      if (character.id === 'akane') game.vehicle = 'car';
    }
  }

  for (const hazard of game.hazards) {
    const screenX = game.player.x + hazard.x - game.distance;
    const overlapsX = playerRight > screenX - hazard.width / 2 && playerLeft < screenX + hazard.width / 2;
    if (!overlapsX) continue;
    const groundY = surfaceYAt(hazard.x);
    const obstacleTop = groundY - hazard.height;
    if (playerBottom > obstacleTop && playerTop < groundY) {
      spawnParticles(game.player.x, game.player.y - 30, '#f36f58', 18);
      endGame();
      return;
    }
  }
}

function update(deltaTime) {
  game.elapsed += deltaTime;
  game.wheelRotation += (game.speed * deltaTime) / 19;
  for (const particle of game.particles) {
    particle.age += deltaTime;
    particle.x += particle.velocityX * deltaTime;
    particle.y += particle.velocityY * deltaTime;
    particle.velocityY += 240 * deltaTime;
  }
  game.particles = game.particles.filter((particle) => particle.age < particle.life);

  if (game.state !== 'running') return;
  game.player.jumpBufferTime = Math.max(0, game.player.jumpBufferTime - deltaTime);
  const previousDistance = game.distance;
  game.distance += game.speed * deltaTime;
  game.speed = Math.min(500, 350 + game.distance * 0.0042);
  generateWorld();

  const crossedRamp = game.segments.find((segment) => segment.launchAt
    && previousDistance < segment.launchAt && game.distance >= segment.launchAt);
  if (crossedRamp && game.player.onGround) {
    game.player.onGround = false;
    game.player.jumpsRemaining = 1;
    game.player.coyoteTime = 0;
    game.player.velocityY = -600;
    spawnParticles(game.player.x, game.player.y, '#ffd45e', 12);
    playSound('jump');
  }

  const wasOnGround = game.player.onGround;
  const floorY = surfaceYAt(game.distance);
  if (floorY !== null && game.player.velocityY >= 0 && game.player.y >= floorY - 14) {
    game.player.y = floorY - 14;
    game.player.velocityY = 0;
    game.player.onGround = true;
    game.player.jumpsRemaining = 2;
    game.player.coyoteTime = 0.13;
  } else {
    if (wasOnGround && floorY === null) game.player.coyoteTime = 0.13;
    else if (!wasOnGround) game.player.coyoteTime = Math.max(0, game.player.coyoteTime - deltaTime);
    game.player.onGround = false;
    game.player.velocityY += 1580 * deltaTime;
    game.player.y += game.player.velocityY * deltaTime;
  }

  if (game.player.jumpBufferTime > 0
      && (game.player.onGround || game.player.coyoteTime > 0 || game.player.jumpsRemaining > 0)) {
    performJump();
  }

  if (game.player.y > game.groundY + 32) {
    endGame();
    return;
  }

  checkCollisions();
  if (game.state !== 'running') return;
  const missedCharacter = game.characters.find((character) => (
    !character.caught && game.distance > character.worldX + 43
  ));
  if (missedCharacter) {
    endGame(missedCharacter.failure, missedCharacter);
    return;
  }
  game.segments = game.segments.filter((segment) => segment.end > game.distance - 550);
  game.hazards = game.hazards.filter((hazard) => hazard.x > game.distance - 100);
  game.coinsInWorld = game.coinsInWorld.filter((coin) => coin.x > game.distance - 100);
  updateHud();
}

function gameLoop(time) {
  const deltaTime = game.lastTime ? Math.min((time - game.lastTime) / 1000, 0.035) : 0;
  game.lastTime = time;
  update(deltaTime);
  draw();
  requestAnimationFrame(gameLoop);
}

document.querySelector('#start-button').addEventListener('click', startGame);
document.querySelector('#restart-button').addEventListener('click', startGame);
document.querySelector('.wordmark').addEventListener('click', (event) => {
  event.preventDefault();
  resetGame();
  game.state = 'title';
  document.body.dataset.state = game.state;
  titleScreen.hidden = false;
  gameoverScreen.hidden = true;
});
titleScreen.addEventListener('pointerdown', (event) => {
  if (event.target.closest('button')) return;
  startGame();
  jump();
});
canvas.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  jump();
});
soundButton.addEventListener('click', toggleSound);
window.addEventListener('keydown', (event) => {
  if (!['Space', 'ArrowUp', 'KeyW'].includes(event.code) || event.repeat) return;
  event.preventDefault();
  if (game.state === 'title') startGame();
  else jump();
});
window.addEventListener('resize', resizeCanvas);

bestDisplay.textContent = game.best.toLocaleString();
resizeCanvas();
requestAnimationFrame(gameLoop);
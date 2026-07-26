const chapters = [...document.querySelectorAll('.chapter')];
const links = [...document.querySelectorAll('.chapter-link')];
const progress = document.querySelector('#progressBar');
const chapterNumber = document.querySelector('#chapterNumber');
let currentChapter = 0;

function showChapter(id) {
  const index = chapters.findIndex((chapter) => chapter.id === id);
  if (index < 0) return;
  chapters.forEach((chapter, i) => {
    chapter.hidden = i !== index;
    chapter.classList.toggle('active', i === index);
  });
  links.forEach((link) => link.classList.toggle('active', link.dataset.target === id));
  currentChapter = index;
  progress.style.width = `${(index + 1) * 25}%`;
  chapterNumber.textContent = String(index + 1).padStart(2, '0');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

links.forEach((link) => link.addEventListener('click', () => showChapter(link.dataset.target)));
document.querySelectorAll('[data-next]').forEach((button) => button.addEventListener('click', () => showChapter(button.dataset.next)));
document.addEventListener('keydown', (event) => {
  if (['INPUT', 'SELECT'].includes(document.activeElement.tagName)) return;
  if (event.key === 'ArrowRight') showChapter(chapters[Math.min(currentChapter + 1, chapters.length - 1)].id);
  if (event.key === 'ArrowLeft') showChapter(chapters[Math.max(currentChapter - 1, 0)].id);
});

const objectCopy = {
  port: ['A label, not a container.', 'It has no buffer, state, or process owner.'],
  socket: ['A real kernel object.', 'It owns buffers, protocol state, and a file descriptor.']
};
document.querySelectorAll('.object').forEach((object) => object.addEventListener('click', () => {
  document.querySelectorAll('.object').forEach((item) => {
    item.classList.toggle('selected', item === object);
    item.setAttribute('aria-pressed', String(item === object));
  });
  const [title, detail] = objectCopy[object.dataset.object];
  document.querySelector('#objectCaption').innerHTML = `<b>${title}</b><span>${detail}</span>`;
}));

const packet = document.querySelector('#packet');
const portInput = document.querySelector('#portInput');
const protocol = document.querySelector('#protocol');
const lookupStatus = document.querySelector('#lookupStatus');
function updatePacket() {
  const port = Math.max(0, Math.min(65535, Number(portInput.value) || 0));
  packet.querySelector('b').innerHTML = `192.168.1.10:<mark>${port}</mark>`;
  packet.querySelector('span').textContent = protocol.value;
}
portInput.addEventListener('input', updatePacket);
protocol.addEventListener('change', updatePacket);
document.querySelector('#sendPacket').addEventListener('click', () => {
  if (packet.classList.contains('travel')) return;
  document.querySelectorAll('.socket-row').forEach((row) => row.classList.remove('match'));
  updatePacket();
  packet.classList.add('travel');
  lookupStatus.innerHTML = '<span>LOOKING UP</span>Scanning the socket table…';
  window.setTimeout(() => {
    const selector = `.socket-row[data-port="${portInput.value}"]`;
    const match = [...document.querySelectorAll(selector)].find((row) => row.querySelector('code').textContent.startsWith(protocol.value));
    if (match) {
      match.classList.add('match');
      lookupStatus.innerHTML = `<span>MATCH FOUND</span>Payload queued to ${match.querySelector('span').textContent}'s socket.`;
    } else {
      lookupStatus.innerHTML = '<span>NO SOCKET</span>Nothing is listening here. The packet is rejected.';
    }
    packet.classList.remove('travel');
  }, 1050);
});

const clients = [
  ['10.0.0.55', '54321', 12], ['10.0.0.66', '12345', 15],
  ['10.0.0.77', '33445', 18], ['10.0.0.88', '60214', 21]
];
const clientList = document.querySelector('#clientList');
const tuple = document.querySelector('#tuple code');
let clientCount = 0;
function selectClient(button, client) {
  document.querySelectorAll('.client').forEach((item) => item.classList.toggle('selected', item === button));
  tuple.textContent = `( ${client[0]}, ${client[1]}, 192.168.1.10, 80, TCP )`;
}
document.querySelector('#addClient').addEventListener('click', () => {
  if (clientCount === clients.length) return;
  const client = clients[clientCount++];
  const button = document.createElement('button');
  button.className = 'client';
  button.innerHTML = `<small>ESTABLISHED · fd ${client[2]}</small><code>${client[0]}:${client[1]} → :80</code>`;
  button.addEventListener('click', () => selectClient(button, client));
  clientList.append(button);
  selectClient(button, client);
});
document.querySelector('#resetClients').addEventListener('click', () => {
  clientCount = 0;
  clientList.replaceChildren();
  tuple.textContent = 'Accept a client to begin';
});

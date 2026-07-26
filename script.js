const clients = [
  { ip: '10.0.0.55', port: '54321', fd: 12 },
  { ip: '10.0.0.66', port: '12345', fd: 15 },
  { ip: '10.0.0.77', port: '33445', fd: 18 },
  { ip: '10.0.0.88', port: '60214', fd: 21 },
  { ip: '10.0.0.99', port: '49152', fd: 24 },
  { ip: '10.0.0.42', port: '51820', fd: 27 }
];

const container = document.querySelector('#connections');
const readout = document.querySelector('#tupleReadout code');
const button = document.querySelector('#acceptClient');
let visible = 0;

function selectConnection(buttonElement, client) {
  document.querySelectorAll('.connection').forEach((item) => item.classList.remove('active'));
  buttonElement.classList.add('active');
  readout.textContent = `( ${client.ip}, ${client.port}, 192.168.1.10, 80, TCP )`;
}

function addClient() {
  const client = clients[visible % clients.length];
  if (visible >= clients.length) container.replaceChildren();
  if (visible >= clients.length) visible = 0;
  const connection = document.createElement('button');
  connection.className = 'connection';
  connection.innerHTML = `<span class="fd">fd ${client.fd}</span><strong>ESTABLISHED</strong><small>${client.ip}:${client.port} → :80</small>`;
  connection.addEventListener('click', () => selectConnection(connection, client));
  container.append(connection);
  selectConnection(connection, client);
  visible += 1;
}

button.addEventListener('click', addClient);
clients.slice(0, 3).forEach(() => addClient());

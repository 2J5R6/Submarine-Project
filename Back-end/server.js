const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const { Server: SocketIOServer } = require('socket.io');

// Configuración del servidor Express
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
let ESP32_WS_URL = process.env.ESP32_WS_URL || 'ws://192.168.1.100:81'; // IP por defecto

// Crear servidor HTTP
const server = http.createServer(app);

// Configurar Socket.IO para comunicación con el cliente web
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Cliente WebSocket para conectarse a la ESP32
let esp32Connection = null;
let reconnectInterval = null;
let isConnected = false;

// Función para conectar con ESP32
function connectToESP32(url = ESP32_WS_URL) {
  // Actualizar la URL global
  ESP32_WS_URL = url;
  
  if (esp32Connection) {
    try {
      esp32Connection.terminate();
    } catch (error) {
      console.error('Error al cerrar la conexión anterior:', error);
    }
  }

  console.log(`Intentando conectar a ESP32: ${ESP32_WS_URL}`);
  
  try {
    esp32Connection = new WebSocket(ESP32_WS_URL, {
      // Añadimos un timeout más largo para la conexión
      handshakeTimeout: 8000
    });

    esp32Connection.on('open', () => {
      console.log('Conexión establecida con ESP32');
      isConnected = true;
      if (reconnectInterval) {
        clearInterval(reconnectInterval);
        reconnectInterval = null;
      }
      // Informar a todos los clientes web que estamos conectados
      io.emit('esp32Status', { connected: true, url: ESP32_WS_URL });
      
      // Enviar un ping cada 30 segundos para mantener viva la conexión
      if (esp32Connection.pingInterval) clearInterval(esp32Connection.pingInterval);
      esp32Connection.pingInterval = setInterval(() => {
        if (esp32Connection && esp32Connection.readyState === WebSocket.OPEN) {
          try {
            esp32Connection.ping();
          } catch (error) {
            console.error('Error al enviar ping:', error);
          }
        }
      }, 30000);
    });

    esp32Connection.on('message', (data) => {
      const message = data.toString();
      try {
        const parsedData = parseESP32Data(message);
        io.emit('submarineData', parsedData);
      } catch (error) {
        console.error('Error al procesar los datos:', error, 'Datos recibidos:', message);
        // No bloqueamos la comunicación, solo registramos el error
      }
    });

    esp32Connection.on('error', (error) => {
      console.error('Error en la conexión con ESP32:', error.message);
      // No cerramos la conexión aquí, dejamos que el evento 'close' se encargue
    });

    esp32Connection.on('close', (code, reason) => {
      console.log(`Conexión con ESP32 cerrada. Código: ${code}, Razón: ${reason || 'No especificada'}`);
      isConnected = false;
      
      // Limpiar el intervalo de ping si existe
      if (esp32Connection && esp32Connection.pingInterval) {
        clearInterval(esp32Connection.pingInterval);
        esp32Connection.pingInterval = null;
      }
      
      io.emit('esp32Status', { 
        connected: false, 
        url: ESP32_WS_URL,
        lastError: `Conexión cerrada. Código: ${code}` 
      });
      
      // Intentar reconexión con backoff exponencial
      if (!reconnectInterval) {
        let retryCount = 0;
        const maxRetries = 10; // Máximo número de intentos
        const initialDelay = 1000; // 1 segundo
        
        reconnectInterval = setInterval(() => {
          if (retryCount >= maxRetries) {
            clearInterval(reconnectInterval);
            reconnectInterval = null;
            console.log('Se alcanzó el máximo número de intentos de reconexión');
            io.emit('esp32Status', { 
              connected: false, 
              url: ESP32_WS_URL,
              lastError: 'Máximo número de intentos alcanzado. Verifique la conexión.' 
            });
            return;
          }
          
          const delay = initialDelay * Math.pow(1.5, retryCount);
          console.log(`Reintentando conexión en ${delay}ms (intento ${retryCount + 1}/${maxRetries})`);
          retryCount++;
          
          connectToESP32(ESP32_WS_URL);
        }, initialDelay);
      }
    });
  } catch (error) {
    console.error('Error al crear la conexión WebSocket:', error);
    isConnected = false;
    io.emit('esp32Status', { 
      connected: false, 
      url: ESP32_WS_URL,
      lastError: `Error al conectar: ${error.message}` 
    });
    
    // Intentar reconexión después de un tiempo
    setTimeout(() => {
      if (!reconnectInterval) {
        reconnectInterval = setInterval(() => connectToESP32(ESP32_WS_URL), 5000);
      }
    }, 2000);
  }
}

// Función para analizar los datos de la ESP32
function parseESP32Data(data) {
  // Formato esperado: "T:valor,A:ax,ay,az,G:gx,gy,gz,M:mx,my,mz"
  const result = {
    timestamp: Date.now(),
    temperature: 0,
    acceleration: { x: 0, y: 0, z: 0 },
    gyroscope: { x: 0, y: 0, z: 0 },
    magnetometer: { x: 0, y: 0, z: 0 },
    // Calculados a partir de la aceleración
    velocity: { x: 0, y: 0, z: 0 },
    position: { x: 0, y: 0, z: 0 }
  };

  // Variables estáticas para el cálculo de velocidad y posición
  // (Estas deberían ser variables globales en una implementación real)
  if (!parseESP32Data.lastTimestamp) {
    parseESP32Data.lastTimestamp = Date.now();
    parseESP32Data.lastVelocity = { x: 0, y: 0, z: 0 };
    parseESP32Data.lastPosition = { x: 0, y: 0, z: 0 };
  }

  const segments = data.split(',');
  segments.forEach(segment => {
    const [type, ...values] = segment.split(':');
    const valuesStr = values.join(':'); // Por si hay otros : en los datos

    switch (type) {
      case 'T':
        result.temperature = parseFloat(valuesStr);
        break;
      case 'A':
        const accValues = valuesStr.split(',');
        if (accValues.length === 3) {
          result.acceleration.x = parseFloat(accValues[0]);
          result.acceleration.y = parseFloat(accValues[1]);
          result.acceleration.z = parseFloat(accValues[2]);
        }
        break;
      case 'G':
        const gyroValues = valuesStr.split(',');
        if (gyroValues.length === 3) {
          result.gyroscope.x = parseFloat(gyroValues[0]);
          result.gyroscope.y = parseFloat(gyroValues[1]);
          result.gyroscope.z = parseFloat(gyroValues[2]);
        }
        break;
      case 'M':
        const magValues = valuesStr.split(',');
        if (magValues.length === 3) {
          result.magnetometer.x = parseFloat(magValues[0]);
          result.magnetometer.y = parseFloat(magValues[1]);
          result.magnetometer.z = parseFloat(magValues[2]);
        }
        break;
    }
  });

  // Calcular velocidad y posición a partir de la aceleración (integración simple)
  const now = Date.now();
  const deltaTime = (now - parseESP32Data.lastTimestamp) / 1000; // convertir a segundos
  
  // Calcular velocidad: v = v0 + a*t
  result.velocity.x = parseESP32Data.lastVelocity.x + result.acceleration.x * deltaTime;
  result.velocity.y = parseESP32Data.lastVelocity.y + result.acceleration.y * deltaTime;
  result.velocity.z = parseESP32Data.lastVelocity.z + result.acceleration.z * deltaTime;
  
  // Calcular posición: p = p0 + v*t + (1/2)*a*t^2
  result.position.x = parseESP32Data.lastPosition.x + parseESP32Data.lastVelocity.x * deltaTime + 0.5 * result.acceleration.x * deltaTime * deltaTime;
  result.position.y = parseESP32Data.lastPosition.y + parseESP32Data.lastVelocity.y * deltaTime + 0.5 * result.acceleration.y * deltaTime * deltaTime;
  result.position.z = parseESP32Data.lastPosition.z + parseESP32Data.lastVelocity.z * deltaTime + 0.5 * result.acceleration.z * deltaTime * deltaTime;
  
  // Actualizar valores para la próxima iteración
  parseESP32Data.lastTimestamp = now;
  parseESP32Data.lastVelocity = { ...result.velocity };
  parseESP32Data.lastPosition = { ...result.position };

  return result;
}

// Conexiones de Socket.IO con clientes web
io.on('connection', (socket) => {
  console.log('Cliente web conectado');
  
  // Enviar estado actual de la conexión con ESP32
  socket.emit('esp32Status', { connected: isConnected, url: ESP32_WS_URL });
  
  // Manejar eventos del cliente web
  socket.on('toggleAutoMode', (data) => {
    console.log(`Modo automático: ${data.enabled ? 'activado' : 'desactivado'}`);
    // Aquí podríamos enviar comandos a la ESP32 si fuera necesario
    
    // Notificar a todos los clientes del cambio
    io.emit('autoModeStatus', { enabled: data.enabled });
  });
  
  // Nueva función para actualizar la IP del STM32/ESP32
  socket.on('updateSTM32IP', (data) => {
    if (data && data.ip) {
      const newUrl = `ws://${data.ip}:${data.port || '81'}`;
      console.log(`Actualizando dirección del STM32 a: ${newUrl}`);
      
      // Intentar conectarse a la nueva dirección
      connectToESP32(newUrl);
      
      // Informar a todos los clientes de la nueva dirección
      io.emit('stm32UrlUpdated', { url: newUrl });
    }
  });
  
  socket.on('disconnect', () => {
    console.log('Cliente web desconectado');
  });
});

// Ruta para comprobar el estado del servidor
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    esp32Connected: isConnected,
    esp32Url: ESP32_WS_URL
  });
});

// Ruta para actualizar la dirección IP del STM32
app.post('/api/update-stm32-url', (req, res) => {
  const { ip, port } = req.body;
  if (!ip) {
    return res.status(400).json({ error: 'Se requiere una dirección IP' });
  }
  
  const newUrl = `ws://${ip}:${port || '81'}`;
  console.log(`Actualizando dirección del STM32 a: ${newUrl}`);
  
  // Intentar conectarse a la nueva dirección
  connectToESP32(newUrl);
  
  // Informar a todos los clientes de la nueva dirección
  io.emit('stm32UrlUpdated', { url: newUrl });
  
  return res.json({ success: true, url: newUrl });
});

// Iniciar el servidor
server.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
  connectToESP32(); // Iniciar conexión con ESP32
});
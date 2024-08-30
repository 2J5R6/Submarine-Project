import React, { useState } from 'react';

const ConnectionButton = () => {
    const [isConnected, setIsConnected] = useState(false);

    const handleConnect = () => {
        // Lógica para conectarse con la ESP32
        setIsConnected(!isConnected);
    };

    return (
        <button onClick={handleConnect}>
            {isConnected ? 'Disconnect' : 'Connect'}
        </button>
    );
};

export default ConnectionButton;
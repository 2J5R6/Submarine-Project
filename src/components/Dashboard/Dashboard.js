// src/components/Dashboard.js
import React from 'react';
import ConnectionButton from './ConnectionButton';
import Submarine3D from './Submarine3D';
import { Line } from 'react-chartjs-2';

const Dashboard = () => {
    // Aquí se incluirán los estados y funciones necesarios
    return (
        <div>
            <h1>Submarine Dashboard</h1>
            <ConnectionButton />
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                {/* Gráficas */}
                <div>
                    <h2>Position</h2>
                    {/* <Line data=datos para la gráfica de posición /> */}
                    {/* Gráficas adicionales */}
                </div>
                {/* Submarino 3D */}
                <Submarine3D />
            </div>
        </div>
    );
};

export default Dashboard;

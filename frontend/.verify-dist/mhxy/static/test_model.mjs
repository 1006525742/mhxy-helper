import * as tf from '@tensorflow/tfjs-node';
import { readFileSync } from 'fs';

async function test() {
    console.log('Loading model...');
    const model = await tf.loadGraphModel('file://./models/keju/model.json');
    console.log('Model loaded');
    
    // Check input/output
    const sig = model.modelSignature;
    console.log('Input:', Object.keys(sig.inputs));
    console.log('Output:', Object.keys(sig.outputs));
    
    const inputName = Object.keys(sig.inputs)[0];
    const inputShape = sig.inputs[inputName].tensorShape.dim.map(d => d.size);
    console.log('Input shape:', inputShape);
    
    // Create dummy input
    const input = tf.zeros([1, 480, 480, 3]);
    
    console.log('Running inference...');
    const inputData = {};
    inputData[inputName] = input;
    const output = model.execute(inputData);
    
    console.log('Output shape:', output.shape);
    const data = output.dataSync();
    
    // Find max score
    let maxScore = 0;
    let maxIdx = -1;
    for (let i = 0; i < 300; i++) {
        const score = data[i * 6 + 4];
        if (score > maxScore) {
            maxScore = score;
            maxIdx = i;
        }
    }
    console.log('Max score:', maxScore, 'at index', maxIdx);
    
    if (maxIdx >= 0) {
        const offset = maxIdx * 6;
        console.log('Detection:', {
            x1: data[offset],
            y1: data[offset + 1],
            x2: data[offset + 2],
            y2: data[offset + 3],
            score: data[offset + 4],
            classId: data[offset + 5]
        });
    }
    
    input.dispose();
    output.dispose();
}

test().catch(console.error);

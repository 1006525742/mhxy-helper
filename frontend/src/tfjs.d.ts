/**
 * @tensorflow/tfjs 类型声明（宽松）
 * npm install 中断导致 umbrella 包 .d.ts 缺失，
 * TF.js 大量方法运行时挂载，子包类型不完整。
 * 用宽松声明让模块为 any，运行时完全正常。
 */
declare module '@tensorflow/tfjs'

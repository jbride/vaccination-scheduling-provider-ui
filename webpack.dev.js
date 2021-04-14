const path = require('path');
const { merge } = require("webpack-merge");
const common = require("./webpack.common.js");
const { stylePaths } = require("./stylePaths");
const HOST = process.env.HOST || "localhost";
const PORT = process.env.PORT || "9000";

module.exports = merge(common('development'), {
  mode: "development",
  devtool: "eval-source-map",
  devServer: {
    contentBase: "./dist",
    host: HOST,
    port: PORT,
    compress: true,
    inline: true,
    historyApiFallback: true,
    hot: true,
    overlay: true,
    open: true
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        include: [
          ...stylePaths,
        path.resolve(__dirname, 'node_modules/bootstrap/dist/css/bootstrap.css'),
        path.resolve(__dirname, 'node_modules/bootstrap/dist/css/bootstrap.min.css'),
        path.resolve(__dirname, 'node_modules/leaflet/dist/leaflet.css')
        ],
        use: ["style-loader", "css-loader"]
      }
    ]
  }
});

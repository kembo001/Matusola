// Connects to Digital Ocean Spaces and uses the AWS-SDK module
// to interact with the S3 equivalent bucket

const AWS = require("aws-sdk");
const spacesEndpoint = new AWS.Endpoint("sfo3.digitaloceanspaces.com");

// This creates the connection with our credentials
const s3 = new AWS.S3({
  endpoint: spacesEndpoint,
  accessKeyId: "DO801VJZERBNVDNDDRCG",
  secretAccessKey: "PZVBpWiUBqG2heLJ55xsH8kp8ucaVLKUCH2LqFFu62A",
  region: "sfo3",
});

module.exports = s3;

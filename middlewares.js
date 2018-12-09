module.exports = () => (req, res, next) => {
  console.log('arguments', arguments)
  console.log('req', req)

  return next()
};

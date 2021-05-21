const Express = require('express')

const app = new Express()

app.use(Express.text())

app.post('/', (req, res) => {
  console.log(`${new Date().toLocaleString()}\n${req.body}\n\n`)
  res.send('')
})

app.listen(3000)

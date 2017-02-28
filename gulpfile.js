
var gulp = require('gulp')
exec = require('child_process').exec

var srcFile = 'mingo-es5x.js'
var outFile = 'mingo.js'

gulp.task('build', function (cb) {
  exec('npm run build', function (err) {
    if (err) return cb(err)
    cb()
  })
})

gulp.task('test', function (cb) {
  exec('npm test', function (err) {
    if (err) return cb(err)
    cb()
  })
})

gulp.task('compile', function (cb) {
  exec(['node_modules/babel-cli/bin/babel.js', srcFile, '-o', outFile].join(' '), function (err) {
    if (err) return cb(err)
    cb()
  })
})

gulp.task('watch', function () {
  gulp.watch(srcFile, ['compile', 'test'])
  gulp.watch('test/*.js', ['test'])
})

gulp.task('default', ['watch'])

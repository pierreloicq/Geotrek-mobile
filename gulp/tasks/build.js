var gulp = require('gulp');

gulp.task('build', [
    'browserify',
    'vendors',
    'sass'
]);
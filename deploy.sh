#!/bin/sh

project=streamMyMusicSkill

outputFolder=$HOME/aws/$project/deploy/
cur_dir=${PWD}

rm -rf $outputFolder

if [ ! -d "$HOME/aws" ]; then
	mkdir $HOME/aws
fi

if [ ! -d "$HOME/aws/$project" ]; then
	mkdir $HOME/aws/$project
fi

if [ ! -d "$HOME/aws/$project/deploy" ]; then
	mkdir $HOME/aws/$project/deploy
fi

outputFile=$outputFolder/$project.zip 

echo "Creating deployment zip file $outputFile\n"

zip -r -9 $outputFile $cur_dir

bucketName="usyp0q.lambda.code.zips"

"Syncing deployment to s3 bucket $bucketName\n"
aws s3 sync $outputFolder s3://$bucketName

